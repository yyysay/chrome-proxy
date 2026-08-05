import "./onboarding.css";
import {
  BUILTIN_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../rule-packs/catalog";

const INSTALL_TIME_KEY = "installedAt";
const PROXY_CONFIG_KEY = "proxyConfig";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const FALLBACK_MODE_KEY = "fallbackMode";

type FallbackMode = "direct" | "proxy" | "system";

interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`页面缺少必要元素：${selector}`);
  }

  return element;
}

const form = requiredElement<HTMLFormElement>("#proxy-form");
const hostInput = requiredElement<HTMLInputElement>("#proxy-host");
const portInput = requiredElement<HTMLInputElement>("#proxy-port");
const statusElement = requiredElement<HTMLElement>("#status");
const versionElement = requiredElement<HTMLElement>("#version");
const installedAtElement =
  requiredElement<HTMLElement>("#installed-at");
const rulePackListElement =
  requiredElement<HTMLElement>("#rule-pack-list");
const rulePackCountElement =
  requiredElement<HTMLElement>("#rule-pack-count");
const rulePackStatusElement =
  requiredElement<HTMLElement>("#rule-pack-status");
const fallbackModeElement =
  requiredElement<HTMLSelectElement>("#fallback-mode");
const fallbackDescriptionElement =
  requiredElement<HTMLElement>("#fallback-description");
const fallbackStatusElement =
  requiredElement<HTMLElement>("#fallback-status");
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"),
);
const tabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-tab-panel]"),
);

versionElement.textContent = chrome.runtime.getManifest().version;

function validateHost(host: string): boolean {
  if (host.length === 0) {
    return false;
  }

  if (host.includes("://") || host.includes("/")) {
    return false;
  }

  return true;
}

function getSelectedRulePackIds(): string[] {
  return Array.from(
    rulePackListElement.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    ),
  ).map((input) => input.value);
}

function updateRulePackCount(enabledIds: readonly string[]): void {
  rulePackCountElement.textContent =
    `${enabledIds.length}/${BUILTIN_RULE_PACKS.length} 已启用`;
}

async function saveRulePackSelection(): Promise<void> {
  const enabledIds = getSelectedRulePackIds();
  const response = (await chrome.runtime.sendMessage({
    type: "UPDATE_RULE_PACKS",
    enabledPackIds: enabledIds,
  })) as {
    ok: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "规则包应用失败");
  }

  updateRulePackCount(enabledIds);
  rulePackStatusElement.textContent =
    response.message ?? "规则包已保存";
}

function activateTab(tabId: string): void {
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== tabId;
  }
}

const FALLBACK_DESCRIPTIONS: Record<FallbackMode, string> = {
  direct: "未命中规则的网站由 Chrome 直接连接。",
  proxy: "未命中规则的网站全部使用当前局域网 HTTP 代理。",
  system: "交还 Chrome 系统代理模式；规则包分流会暂停。",
};

async function saveFallbackMode(): Promise<void> {
  const fallbackMode = fallbackModeElement.value as FallbackMode;
  fallbackDescriptionElement.textContent =
    FALLBACK_DESCRIPTIONS[fallbackMode];

  const response = (await chrome.runtime.sendMessage({
    type: "UPDATE_FALLBACK_MODE",
    fallbackMode,
  })) as {
    ok: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "兜底策略保存失败");
  }

  fallbackStatusElement.textContent =
    response.message ?? "兜底策略已保存";
}

function renderRulePacks(enabledIds: readonly string[]): void {
  const enabledSet = new Set(enabledIds);
  const fragment = document.createDocumentFragment();

  for (const pack of BUILTIN_RULE_PACKS) {
    const label = document.createElement("label");
    label.className = "rule-pack-item";

    const copy = document.createElement("span");
    copy.className = "rule-pack-copy";

    const name = document.createElement("strong");
    name.textContent = pack.name;

    const description = document.createElement("small");
    description.textContent = pack.description;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = pack.id;
    checkbox.checked = enabledSet.has(pack.id);
    checkbox.addEventListener("change", () => {
      void saveRulePackSelection().catch((error: unknown) => {
        console.error(error);
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "规则包保存失败";
      });
    });

    copy.append(name, description);
    label.append(copy, checkbox);
    fragment.append(label);
  }

  rulePackListElement.replaceChildren(fragment);
  updateRulePackCount(enabledIds);
}

async function loadStoredData(): Promise<void> {
  const result = await chrome.storage.local.get([
    INSTALL_TIME_KEY,
    PROXY_CONFIG_KEY,
    ENABLED_RULE_PACK_IDS_KEY,
    FALLBACK_MODE_KEY,
  ]);

  const installedAt = result[INSTALL_TIME_KEY] as string | undefined;
  const proxyConfig = result[PROXY_CONFIG_KEY] as ProxyConfig | undefined;
  const storedEnabledIds = result[ENABLED_RULE_PACK_IDS_KEY] as unknown;
  const enabledIds = Array.isArray(storedEnabledIds)
    ? storedEnabledIds.filter((id): id is string => typeof id === "string")
    : [...DEFAULT_ENABLED_RULE_PACK_IDS];
  const storedFallbackMode = result[FALLBACK_MODE_KEY] as unknown;
  const fallbackMode: FallbackMode =
    storedFallbackMode === "proxy" || storedFallbackMode === "system"
      ? storedFallbackMode
      : "direct";

  renderRulePacks(enabledIds);
  fallbackModeElement.value = fallbackMode;
  fallbackDescriptionElement.textContent =
    FALLBACK_DESCRIPTIONS[fallbackMode];

  installedAtElement.textContent = installedAt
    ? new Date(installedAt).toLocaleString("zh-CN")
    : "暂无记录";

  if (!proxyConfig) {
    statusElement.textContent = "尚未保存代理配置";
    return;
  }

  hostInput.value = proxyConfig.host;
  portInput.value = String(proxyConfig.port);

  statusElement.textContent =
    `已读取配置：http://${proxyConfig.host}:${proxyConfig.port}`;
}

async function saveProxyConfig(): Promise<void> {
  const host = hostInput.value.trim();
  const port = Number(portInput.value);

  if (!validateHost(host)) {
    statusElement.textContent =
      "代理地址只填写主机名或 IP，例如 127.0.0.1。";
    return;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    statusElement.textContent =
      "端口必须是 1 到 65535 之间的整数。";
    return;
  }

  const proxyConfig: ProxyConfig = {
    type: "http",
    host,
    port,
  };

  await chrome.storage.local.set({
    [PROXY_CONFIG_KEY]: proxyConfig,
  });

  statusElement.textContent =
    `保存成功：http://${host}:${port}`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  void saveProxyConfig().catch((error: unknown) => {
    console.error(error);

    statusElement.textContent =
      error instanceof Error ? error.message : "保存失败";
  });
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;

    if (target) {
      activateTab(target);
    }
  });
}

fallbackModeElement.addEventListener("change", () => {
  void saveFallbackMode().catch((error: unknown) => {
    console.error(error);
    fallbackStatusElement.textContent =
      error instanceof Error ? error.message : "兜底策略保存失败";
  });
});

void loadStoredData().catch((error: unknown) => {
  console.error(error);

  statusElement.textContent =
    error instanceof Error ? error.message : "读取配置失败";
});
