import "../ui/ui.css";
import { validateConfigDocument } from "../config/config-document.ts";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import type { ProxyStatus } from "../proxy/pac-controller.ts";
import type { ActiveSiteProxyStatus } from "../shared/runtime-protocol.ts";
import { fetchRemoteYaml, requestUrlPermissions, sendMessage } from "../settings/runtime-client.ts";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup 页面缺少必要元素：${selector}`);
  return element;
}

const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const popupRoot = requiredElement<HTMLElement>("main");
const proxyToggleButton = requiredElement<HTMLButtonElement>("#proxy-toggle");
const toggleLabel = requiredElement<HTMLElement>("#toggle-label");
const popupIcon = requiredElement<HTMLElement>("#popup-icon");
const popupIconImages = [...popupIcon.querySelectorAll<HTMLImageElement>("img")];
const siteHost = requiredElement<HTMLElement>("#site-host");
const siteStatus = requiredElement<HTMLElement>("#site-status");
const subscriptionForm = requiredElement<HTMLFormElement>("#popup-subscription-form");
const subscriptionInput = requiredElement<HTMLInputElement>("#popup-subscription-url");
const subscriptionSubmit = requiredElement<HTMLButtonElement>("#popup-subscription-submit");
const subscriptionCancel = requiredElement<HTMLButtonElement>("#popup-subscription-cancel");
const subscriptionEdit = requiredElement<HTMLButtonElement>("#popup-subscription-edit");
const subscriptionControl = requiredElement<HTMLElement>("#popup-subscription-control");
const subscriptionEntryLabel = requiredElement<HTMLElement>("#popup-subscription-entry-label");
const subscriptionTitle = requiredElement<HTMLElement>("#popup-subscription-title");
const subscriptionError = requiredElement<HTMLElement>("#popup-subscription-error");
const subscriptionSpinner = requiredElement<SVGElement>("#popup-subscription-spinner");
const subscriptionSubmitLabel = requiredElement<HTMLElement>("#popup-subscription-submit-label");

let enabled = false;
let subscriptionIntervalSeconds = 86_400;
let subscriptionSourceUrl = "";
let togglePending = false;
let engineRendered = false;
let subscriptionRendered = false;
let subscriptionEditorOpen = false;
const popupIconDecoded = Promise.all(popupIconImages.map(async (image) => {
  try {
    await image.decode();
  } catch {
    // decode() 失败时仍允许浏览器按普通图片加载流程显示图标。
  }
}));

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function revealStable(element: HTMLElement): void {
  void element.offsetWidth;
  for (const animation of element.getAnimations({ subtree: true })) {
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  }
  element.classList.remove("invisible");
}

function setSubscriptionFeedback(state: "idle" | "loading" | "success" | "error", message = ""): void {
  const loading = state === "loading";
  const successful = state === "success";
  subscriptionInput.disabled = loading || successful;
  subscriptionCancel.disabled = loading || successful;
  subscriptionSubmit.disabled = loading || successful;
  subscriptionEdit.disabled = loading || successful;
  subscriptionForm.setAttribute("aria-busy", String(loading));
  subscriptionSpinner.classList.toggle("hidden", !loading);
  subscriptionSubmitLabel.textContent = loading ? "正在应用" : state === "error" ? "重新应用" : "应用订阅";
  subscriptionError.textContent = message;
  subscriptionError.hidden = state !== "error";
  subscriptionInput.setAttribute("aria-invalid", String(state === "error"));
}

function setSubscriptionAppliedFeedback(applied: boolean): void {
  subscriptionControl.classList.toggle("applied", applied);
  if (applied) subscriptionControl.classList.remove("configured");
  subscriptionEntryLabel.textContent = applied ? "已应用" : "添加订阅";
  subscriptionEdit.setAttribute("aria-label", applied ? "订阅已应用" : "添加订阅");
  subscriptionEdit.title = applied ? "订阅已应用" : "添加订阅";
}

function setSubscriptionEditor(open: boolean): void {
  subscriptionEditorOpen = open;
  if (open) {
    const buttonRect = subscriptionEdit.getBoundingClientRect();
    const popupRect = popupRoot.getBoundingClientRect();
    const formLeft = popupRect.left + (popupRect.width - subscriptionForm.offsetWidth) / 2;
    const originX = buttonRect.left + buttonRect.width / 2 - formLeft;
    subscriptionForm.style.transformOrigin = `${originX}px 0`;
  }
  subscriptionForm.classList.toggle("open", open);
  subscriptionForm.inert = !open;
  subscriptionForm.setAttribute("aria-hidden", String(!open));
  subscriptionControl.classList.toggle("editor-open", open);
  subscriptionEdit.setAttribute("aria-expanded", String(open));
  if (open) {
    setSubscriptionFeedback("idle");
    subscriptionInput.focus();
    subscriptionInput.select();
  }
}

function renderSubscription(sourceUrl: string): void {
  subscriptionSourceUrl = sourceUrl;
  subscriptionInput.value = sourceUrl;
  const configured = Boolean(sourceUrl);
  subscriptionControl.classList.toggle("configured", configured);
  subscriptionEdit.setAttribute("aria-label", configured ? "管理订阅" : "添加订阅");
  subscriptionEdit.title = configured ? "管理订阅" : "添加订阅";
  subscriptionTitle.textContent = configured ? "管理远程订阅" : "添加远程订阅";
  if (!subscriptionRendered) {
    revealStable(subscriptionControl);
    subscriptionRendered = true;
  }
}

function renderToggle(nextEnabled: boolean): void {
  enabled = nextEnabled;
  proxyToggleButton.setAttribute("aria-checked", String(enabled));
  proxyToggleButton.classList.toggle("active", enabled);
  toggleLabel.textContent = enabled ? "ON" : "OFF";
}

function renderEngine(status: ProxyStatus): void {
  renderToggle(status.configured && (status.desiredEnabled || status.applied));
  proxyToggleButton.disabled = !status.configured;
  proxyToggleButton.title = status.configured ? "" : "请先添加并应用 YAML 配置";
  if (!engineRendered) {
    revealStable(proxyToggleButton);
    engineRendered = true;
  }
}

async function renderPopupIcon(proxied: boolean): Promise<void> {
  await popupIconDecoded;
  popupIcon.classList.toggle("active", proxied);
  document.documentElement.classList.remove("site-proxied");
}

async function refreshSite(): Promise<void> {
  const response = await sendMessage<ActiveSiteProxyStatus>({ type: "GET_ACTIVE_SITE_PROXY_STATUS" });
  if (!response.ok || !response.data) {
    siteHost.textContent = "当前页面";
    siteStatus.textContent = "未知";
    siteStatus.dataset.statusTone = "error";
    await renderPopupIcon(false);
  } else {
    siteHost.textContent = response.data.hostname;
    siteStatus.textContent = response.data.engineEnabled ? response.data.action : response.data.action === "不可用" ? "不可用" : "已关闭";
    siteStatus.dataset.statusTone = response.data.proxied ? "fresh" : "idle";
    await renderPopupIcon(response.data.proxied);
  }
  siteHost.classList.remove("invisible");
  siteStatus.classList.remove("invisible");
}

async function refreshState(): Promise<void> {
  const [statusResponse, configResponse] = await Promise.all([
    sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" }),
    sendMessage<ConfigDocumentState>({ type: "GET_CONFIG_DOCUMENT_STATE" }),
  ]);
  if (!statusResponse.ok || !statusResponse.data) throw new Error(statusResponse.error ?? "代理状态读取失败");
  renderEngine(statusResponse.data);
  if (configResponse.ok && configResponse.data) {
    renderSubscription(configResponse.data.sourceUrl);
    subscriptionIntervalSeconds = configResponse.data.remote.intervalSeconds;
  }
  await refreshSite();
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

proxyToggleButton.addEventListener("click", () => {
  if (togglePending) return;
  const previousEnabled = enabled;
  const nextEnabled = !enabled;
  togglePending = true;
  renderToggle(nextEnabled);
  proxyToggleButton.setAttribute("aria-busy", "true");
  void sendMessage({ type: nextEnabled ? "ENABLE_PROXY" : "DISABLE_PROXY" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "操作失败");
      await refreshState();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      renderToggle(previousEnabled);
      await refreshState().catch(() => { proxyToggleButton.disabled = false; });
    })
    .finally(() => {
      togglePending = false;
      proxyToggleButton.removeAttribute("aria-busy");
    });
});

subscriptionEdit.addEventListener("click", () => setSubscriptionEditor(!subscriptionEditorOpen));
subscriptionInput.addEventListener("input", () => {
  if (!subscriptionError.hidden) setSubscriptionFeedback("idle");
});
subscriptionCancel.addEventListener("click", () => {
  subscriptionInput.value = subscriptionSourceUrl;
  setSubscriptionFeedback("idle");
  setSubscriptionEditor(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && subscriptionEditorOpen) {
    subscriptionInput.value = subscriptionSourceUrl;
    setSubscriptionFeedback("idle");
    setSubscriptionEditor(false);
    subscriptionEdit.focus();
  }
});

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    setSubscriptionFeedback("loading");
    const remote = await fetchRemoteYaml(subscriptionInput.value);
    const validation = validateConfigDocument(remote.yaml);
    if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
    const activeProviders = new Set(validation.document.rules.flatMap((rule) => {
      const parts = rule.split(",").map((part) => part.trim());
      return parts[0]?.toUpperCase() === "RULE-SET" && parts[1] ? [parts[1]] : [];
    }));
    await requestUrlPermissions(Object.values(validation.document.ruleProviders)
      .filter((provider) => activeProviders.has(provider.name))
      .map((provider) => provider.url));
    const response = await sendMessage({
      type: "APPLY_CONFIG_DOCUMENT",
      yaml: remote.yaml,
      sourceUrl: remote.url,
      refreshIntervalSeconds: subscriptionIntervalSeconds,
    });
    if (!response.ok) throw new Error(response.error ?? "订阅更新失败");
    setSubscriptionFeedback("success");
    setSubscriptionEditor(false);
    await delay(220);
    setSubscriptionAppliedFeedback(true);
    await delay(1_800);
    setSubscriptionAppliedFeedback(false);
    renderSubscription(remote.url);
    setSubscriptionFeedback("idle");
    await refreshState().catch((error: unknown) => { console.error(error); });
  })().catch((error) => {
    setSubscriptionFeedback("error", error instanceof Error ? error.message : "订阅更新失败");
    subscriptionInput.focus();
  });
});

void refreshState().catch((error: unknown) => {
  console.error(error);
  proxyToggleButton.disabled = true;
  if (!subscriptionRendered) renderSubscription("");
  if (!engineRendered) {
    revealStable(proxyToggleButton);
    engineRendered = true;
  }
  void renderPopupIcon(false);
  siteHost.textContent = "状态读取失败";
  siteStatus.textContent = "错误";
  siteStatus.dataset.statusTone = "error";
  siteHost.classList.remove("invisible");
  siteStatus.classList.remove("invisible");
});
