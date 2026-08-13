import "../ui/ui.css";
import { validateConfigDocument } from "../config/config-document.ts";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import type { ProxyStatus } from "../proxy/pac-controller.ts";
import {
  fetchRemoteYaml,
  requestUrlPermissions,
  sendMessage,
} from "../settings/runtime-client.ts";

const POPUP_PROXY_STATUS_CACHE_KEY = "popupProxyStatusCache";

interface CachedProxyStatus {
  status: ProxyStatus;
  updatedAt: number;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup 页面缺少必要元素：${selector}`);
  return element;
}

const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const proxyControlCard = requiredElement<HTMLElement>("#proxy-control-card");
const proxyToggleButton = requiredElement<HTMLButtonElement>("#proxy-toggle");
const proxyToggleThumb = requiredElement<HTMLElement>("#proxy-toggle-thumb");
const proxyStatusLabel = requiredElement<HTMLElement>("#proxy-status-label");
const proxyStatusDescription = requiredElement<HTMLElement>(
  "#proxy-status-description",
);
const subscriptionForm = requiredElement<HTMLFormElement>(
  "#popup-subscription-form",
);
const subscriptionInput = requiredElement<HTMLInputElement>(
  "#popup-subscription-url",
);
const subscriptionSubmit = requiredElement<HTMLButtonElement>(
  "#popup-subscription-submit",
);
const subscriptionCancel = requiredElement<HTMLButtonElement>(
  "#popup-subscription-cancel",
);
const subscriptionEdit = requiredElement<HTMLButtonElement>(
  "#popup-subscription-edit",
);
const subscriptionSummary = requiredElement<HTMLElement>(
  "#popup-subscription-summary",
);
const subscriptionHint = requiredElement<HTMLElement>(
  "#popup-subscription-hint",
);

let enabled = false;
let configurationReady = true;
let subscriptionIntervalSeconds = 86_400;
let subscriptionSourceUrl = "";
let subscriptionHintTimer: ReturnType<typeof setTimeout> | undefined;
let subscriptionHintActive = false;
let hasRenderedEngine = false;

function isProxyStatus(value: unknown): value is ProxyStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<ProxyStatus>;
  return (
    typeof status.configured === "boolean" &&
    typeof status.desiredEnabled === "boolean" &&
    typeof status.applied === "boolean"
  );
}

function readCachedStatus(value: unknown): ProxyStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cached = value as Partial<CachedProxyStatus>;
  return isProxyStatus(cached.status) && typeof cached.updatedAt === "number"
    ? cached.status
    : undefined;
}

async function loadCachedStatus(): Promise<ProxyStatus | undefined> {
  const stored = await chrome.storage.session.get(POPUP_PROXY_STATUS_CACHE_KEY);
  return readCachedStatus(stored[POPUP_PROXY_STATUS_CACHE_KEY]);
}

async function cacheStatus(status: ProxyStatus): Promise<void> {
  await chrome.storage.session.set({
    [POPUP_PROXY_STATUS_CACHE_KEY]: {
      status,
      updatedAt: Date.now(),
    } satisfies CachedProxyStatus,
  });
}

function renderPersistentConfigStatus(): void {
  if (subscriptionHintActive) return;
  subscriptionHint.textContent = configurationReady ? "已配置" : "未配置";
  subscriptionHint.dataset.statusTone = configurationReady ? "ready" : "error";
}

function showSubscriptionHint(
  message: string,
  autoHideMs = 0,
  tone: "ready" | "working" | "error" = "working",
): void {
  if (subscriptionHintTimer !== undefined) clearTimeout(subscriptionHintTimer);
  subscriptionHintActive = true;
  subscriptionHint.textContent = message;
  subscriptionHint.dataset.statusTone = tone;
  if (autoHideMs > 0) {
    subscriptionHintTimer = setTimeout(() => {
      subscriptionHintTimer = undefined;
      subscriptionHintActive = false;
      renderPersistentConfigStatus();
    }, autoHideMs);
  }
}

function hideSubscriptionHint(): void {
  if (subscriptionHintTimer !== undefined) clearTimeout(subscriptionHintTimer);
  subscriptionHintTimer = undefined;
  subscriptionHintActive = false;
  renderPersistentConfigStatus();
}

function setSubscriptionEditor(open: boolean): void {
  subscriptionForm.hidden = !open;
  subscriptionEdit.hidden = open;
  if (open) {
    subscriptionInput.focus();
    subscriptionInput.select();
  }
}

function renderSubscription(sourceUrl: string): void {
  subscriptionSourceUrl = sourceUrl;
  subscriptionInput.value = sourceUrl;
  subscriptionSummary.textContent = sourceUrl ? "已配置" : "尚未设置";
  subscriptionSummary.removeAttribute("title");
  subscriptionEdit.textContent = sourceUrl ? "编辑" : "添加";
}

function getTogglePalette(active: boolean): {
  background: string;
  shadow: string;
  status: string;
  border: string;
  cardShadow: string;
} {
  const darkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (active) {
    return {
      background: darkMode ? "#2999f5" : "#168cf1",
      shadow: "0 5px 16px rgba(22, 140, 241, 0.24)",
      status: darkMode ? "#55aff8" : "#0877d4",
      border: darkMode ? "rgba(41, 153, 245, 0.2)" : "rgba(22, 140, 241, 0.16)",
      cardShadow: darkMode
        ? "0 18px 48px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04)"
        : "0 18px 48px rgba(22, 140, 241, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.92)",
    };
  }
  return {
    background: darkMode ? "#3c3c40" : "#d6d7d3",
    shadow: darkMode
      ? "inset 0 1px 3px rgba(0, 0, 0, 0.24)"
      : "inset 0 1px 3px rgba(0, 0, 0, 0.09)",
    status: darkMode ? "rgba(255, 255, 255, 0.9)" : "#292927",
    border: darkMode
      ? "rgba(255, 255, 255, 0.065)"
      : "rgba(255, 255, 255, 0.8)",
    cardShadow: darkMode
      ? "0 18px 48px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04)"
      : "0 16px 44px rgba(35, 52, 43, 0.075), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
  };
}

function applyEngineVisual(nextEnabled: boolean, animate: boolean): void {
  const previousEnabled = enabled;
  const previousPalette = getTogglePalette(previousEnabled);
  const nextPalette = getTogglePalette(nextEnabled);
  const fromX = previousEnabled ? 24 : 0;
  const toX = nextEnabled ? 24 : 0;
  const direction = nextEnabled ? 1 : -1;

  enabled = nextEnabled;
  proxyToggleButton.setAttribute("aria-checked", String(nextEnabled));
  proxyToggleButton.setAttribute(
    "aria-label",
    nextEnabled ? "关闭智能分流" : "开启智能分流",
  );
  proxyToggleButton.classList.toggle("active", nextEnabled);

  proxyToggleButton.style.backgroundColor = nextPalette.background;
  proxyToggleButton.style.boxShadow = nextPalette.shadow;
  proxyToggleThumb.style.transform = `translateX(${toX}px)`;
  proxyStatusLabel.textContent = nextEnabled ? "已启用" : "未启用";
  proxyStatusLabel.style.color = nextPalette.status;
  proxyStatusDescription.textContent = nextEnabled
    ? "规则分流正在运行"
    : "点击右侧开关启用智能分流";
  proxyControlCard.style.borderColor = nextPalette.border;
  proxyControlCard.style.boxShadow = nextPalette.cardShadow;

  if (
    !animate ||
    previousEnabled === nextEnabled ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  for (const animation of [
    ...proxyToggleButton.getAnimations(),
    ...proxyToggleThumb.getAnimations(),
    ...proxyControlCard.getAnimations(),
    ...proxyStatusLabel.getAnimations(),
    ...proxyStatusDescription.getAnimations(),
  ]) {
    animation.cancel();
  }

  proxyToggleButton.animate(
    [
      {
        backgroundColor: previousPalette.background,
        boxShadow: previousPalette.shadow,
        transform: "scale(0.985)",
      },
      {
        backgroundColor: nextPalette.background,
        boxShadow: nextPalette.shadow,
        transform: "scale(1)",
      },
    ],
    {
      duration: 480,
      easing: "cubic-bezier(.22,.72,.22,1)",
    },
  );

  proxyToggleThumb.animate(
    [
      { transform: `translateX(${fromX}px) scale(1)` },
      {
        transform: `translateX(${fromX + (toX - fromX) * 0.8}px) scale(0.94)`,
        offset: 0.55,
      },
      {
        transform: `translateX(${toX + direction * 1.5}px) scale(0.985)`,
        offset: 0.82,
      },
      { transform: `translateX(${toX}px) scale(1)` },
    ],
    {
      duration: 520,
      easing: "cubic-bezier(.22,.72,.22,1)",
    },
  );

  proxyControlCard.animate(
    [
      {
        borderColor: previousPalette.border,
        boxShadow: previousPalette.cardShadow,
      },
      {
        borderColor: nextPalette.border,
        boxShadow: nextPalette.cardShadow,
      },
    ],
    { duration: 520, easing: "cubic-bezier(.22,.72,.22,1)" },
  );

  proxyStatusLabel.animate(
    [
      {
        opacity: 0.25,
        transform: "translateY(4px) scale(0.985)",
      },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 420, easing: "cubic-bezier(.22,.72,.22,1)" },
  );

  proxyStatusDescription.animate(
    [
      { opacity: 0, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 430, delay: 45, easing: "ease-out" },
  );
}

function renderEngine(status: ProxyStatus): void {
  const nextEnabled =
    status.configured && (status.desiredEnabled || status.applied);
  configurationReady = status.configured;
  renderPersistentConfigStatus();
  applyEngineVisual(nextEnabled, false);
  if (!hasRenderedEngine) {
    hasRenderedEngine = true;
    proxyControlCard.style.opacity = "1";
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      proxyControlCard.animate(
        [
          { opacity: 0, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 280, easing: "cubic-bezier(.22,.72,.22,1)" },
      );
    }
  }
  proxyToggleButton.disabled = !status.configured;
  proxyToggleButton.title = status.configured ? "" : "请先添加并应用 YAML 配置";
}

function renderEngineTransition(nextEnabled: boolean): void {
  applyEngineVisual(nextEnabled, true);
}

async function refreshEngine(): Promise<void> {
  const response = await sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? "代理状态读取失败");
  }
  renderEngine(response.data);
  await cacheStatus(response.data);
}

async function refreshConfig(): Promise<void> {
  const configResponse = await sendMessage<ConfigDocumentState>({
    type: "GET_CONFIG_DOCUMENT_STATE",
  });
  if (configResponse.ok && configResponse.data) {
    renderSubscription(configResponse.data.sourceUrl);
    subscriptionIntervalSeconds = configResponse.data.remote.intervalSeconds;
  }
}

async function refreshState(): Promise<void> {
  await Promise.all([refreshEngine(), refreshConfig()]);
}

async function initializeState(): Promise<void> {
  const cachedStatus = await loadCachedStatus();
  if (cachedStatus) {
    renderEngine(cachedStatus);
  } else {
    await refreshEngine();
  }
  await refreshConfig();
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

proxyToggleButton.addEventListener("click", () => {
  const previousEnabled = enabled;
  renderEngineTransition(!previousEnabled);
  proxyToggleButton.disabled = true;
  void sendMessage({ type: previousEnabled ? "DISABLE_PROXY" : "ENABLE_PROXY" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "操作失败");
      await refreshState();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      renderEngineTransition(previousEnabled);
      await refreshState().catch(() => {
        proxyToggleButton.disabled = false;
      });
    });
});

subscriptionEdit.addEventListener("click", () => setSubscriptionEditor(true));
subscriptionCancel.addEventListener("click", () => {
  subscriptionInput.value = subscriptionSourceUrl;
  hideSubscriptionHint();
  setSubscriptionEditor(false);
});

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    subscriptionSubmit.disabled = true;
    showSubscriptionHint("正在下载并校验订阅…", 0, "working");
    const remote = await fetchRemoteYaml(subscriptionInput.value);
    const validation = validateConfigDocument(remote.yaml);
    if (!validation.ok || !validation.document)
      throw new Error(validation.issues[0] ?? "配置无效");
    const activeProviders = new Set(
      validation.document.rules.flatMap((rule) => {
        const parts = rule.split(",").map((part) => part.trim());
        return parts[0]?.toUpperCase() === "RULE-SET" && parts[1]
          ? [parts[1]]
          : [];
      }),
    );
    await requestUrlPermissions(
      Object.values(validation.document.ruleProviders)
        .filter((provider) => activeProviders.has(provider.name))
        .map((provider) => provider.url),
    );
    const response = await sendMessage({
      type: "APPLY_CONFIG_DOCUMENT",
      yaml: remote.yaml,
      sourceUrl: remote.url,
      refreshIntervalSeconds: subscriptionIntervalSeconds,
    });
    if (!response.ok) throw new Error(response.error ?? "订阅更新失败");
    showSubscriptionHint("订阅已更新并应用", 3_000, "ready");
    await refreshState();
    setSubscriptionEditor(false);
  })()
    .catch((error) => {
      showSubscriptionHint(
        error instanceof Error ? error.message : "订阅更新失败",
        4_500,
        "error",
      );
    })
    .finally(() => {
      subscriptionSubmit.disabled = false;
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;
  const change = changes[POPUP_PROXY_STATUS_CACHE_KEY];
  const status = readCachedStatus(change?.newValue);
  if (status) renderEngine(status);
});

void initializeState().catch((error: unknown) => {
  console.error(error);
  proxyControlCard.style.opacity = "1";
  proxyToggleButton.disabled = true;
  configurationReady = false;
  renderPersistentConfigStatus();
});
