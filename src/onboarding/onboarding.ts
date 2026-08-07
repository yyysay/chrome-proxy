import "./onboarding.css";
import {
  DEFAULT_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../rule-packs/catalog";

const INSTALL_TIME_KEY = "installedAt";
const PROXY_CONFIG_KEY = "proxyConfig";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const SIMPLE_ENABLED_RULE_PACK_IDS_KEY = "simpleEnabledRulePackIds";
const FALLBACK_MODE_KEY = "fallbackMode";
const UI_MODE_KEY = "uiMode";
const ACTIVE_TAB_KEY = "activeSettingsTab";
const AUTO_REFRESH_ENABLED_KEY = "autoRuleRefreshEnabled";
const AUTO_REFRESH_INTERVAL_KEY = "autoRuleRefreshIntervalHours";
const NETWORK_INFO_CACHE_KEY = "networkInfoCache";

type FallbackMode = "direct" | "proxy" | "system";
type SourceStrategy = "local-first" | "subscription-first" | "merge";

interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface RulePackSetting {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  defaultAction: "DIRECT" | "PROXY";
  enabled: boolean;
  simpleEnabled?: boolean;
  sourceStrategy?: SourceStrategy;
  source: {
    sourceStrategy?: SourceStrategy;
    url?: string;
    cachedContent?: string;
    customContent?: string;
    updatedAt?: string;
    modifiedAt?: string;
    lastAttemptAt?: string;
    status?: "idle" | "downloading" | "ready" | "cached" | "error";
    error?: string;
  };
  validation?: {
    effective: number;
    ignored: number;
  };
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
const addRulePackButton =
  requiredElement<HTMLButtonElement>("#add-rule-pack");
const refreshEnabledRulesButton =
  requiredElement<HTMLButtonElement>("#refresh-enabled-rules");
const ruleMatchForm =
  requiredElement<HTMLFormElement>("#rule-match-form");
const ruleMatchInput =
  requiredElement<HTMLInputElement>("#rule-match-input");
const ruleMatchResult =
  requiredElement<HTMLElement>("#rule-match-result");
const diagnosticList =
  requiredElement<HTMLElement>("#diagnostic-list");
const diagnosticStatus =
  requiredElement<HTMLElement>("#diagnostic-status");
const clearDiagnosticsButton =
  requiredElement<HTMLButtonElement>("#clear-diagnostics");
const rulesPanel =
  requiredElement<HTMLElement>('[data-tab-panel="rules"]');
const modeDescriptionElement =
  requiredElement<HTMLElement>("#mode-description");
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-ui-mode]"),
);
const presetControls = Array.from(
  document.querySelectorAll<HTMLInputElement>("[data-preset]"),
);
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"),
);
const tabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-tab-panel]"),
);
const aboutButton = requiredElement<HTMLButtonElement>("#about-button");
const aboutPanel = requiredElement<HTMLElement>('[data-view-panel="about"]');
const cardElement = requiredElement<HTMLElement>(".card");
const proxyConfigBadge =
  requiredElement<HTMLElement>("#proxy-config-badge");
const proxyConfigBadgeText =
  requiredElement<HTMLElement>("#proxy-config-badge-text");
const refreshNetworkInfoButton =
  requiredElement<HTMLButtonElement>("#refresh-network-info");
const directExitIpElement =
  requiredElement<HTMLElement>("#direct-exit-ip");
const directExitLocationElement =
  requiredElement<HTMLElement>("#direct-exit-location");
const directExitNetworkElement =
  requiredElement<HTMLElement>("#direct-exit-network");
const directExitTimeElement =
  requiredElement<HTMLElement>("#direct-exit-time");
const proxyExitIpElement =
  requiredElement<HTMLElement>("#proxy-exit-ip");
const proxyExitLocationElement =
  requiredElement<HTMLElement>("#proxy-exit-location");
const proxyExitNetworkElement =
  requiredElement<HTMLElement>("#proxy-exit-network");
const proxyExitTimeElement =
  requiredElement<HTMLElement>("#proxy-exit-time");
const networkRouteSummaryElement =
  requiredElement<HTMLElement>("#network-route-summary");
const networkLastCheckedElement =
  requiredElement<HTMLElement>("#network-last-checked");
const toastHostElement = requiredElement<HTMLElement>("#toast-host");
const autoRefreshEnabledElement =
  requiredElement<HTMLInputElement>("#auto-refresh-enabled");
const autoRefreshIntervalElement =
  requiredElement<HTMLSelectElement>("#auto-refresh-interval");
const autoRefreshStatusElement =
  requiredElement<HTMLElement>("#auto-refresh-status");
const ruleEditorDialog =
  requiredElement<HTMLDialogElement>("#rule-editor-dialog");
const ruleEditorForm =
  requiredElement<HTMLFormElement>("#rule-editor-form");
const ruleEditorTitle =
  requiredElement<HTMLElement>("#rule-editor-title");
const ruleEditorCloseButton =
  requiredElement<HTMLButtonElement>("#rule-editor-close");
const ruleEditorCancelButton =
  requiredElement<HTMLButtonElement>("#rule-editor-cancel");
const ruleEditorDeleteButton =
  requiredElement<HTMLButtonElement>("#rule-editor-delete");
const ruleEditorRefreshButton =
  requiredElement<HTMLButtonElement>("#rule-editor-refresh");
const ruleEditorNameInput =
  requiredElement<HTMLInputElement>("#rule-editor-name");
const ruleEditorUrlInput =
  requiredElement<HTMLInputElement>("#rule-editor-url");
const ruleEditorActionSelect =
  requiredElement<HTMLSelectElement>("#rule-editor-action");
const ruleEditorSourceStrategySelect =
  requiredElement<HTMLSelectElement>("#rule-editor-source-strategy");
const ruleEditorContent =
  requiredElement<HTMLTextAreaElement>("#rule-editor-content");
const ruleEditorMeta =
  requiredElement<HTMLElement>("#rule-editor-meta");

function lockInitialCardHeight(): void {
  const height = Math.ceil(cardElement.getBoundingClientRect().height);
  cardElement.style.setProperty("--tab-card-height", `${height}px`);
  cardElement.classList.add("tab-size-locked");
}
let renderedRulePackSettings: RulePackSetting[] = [];
let currentUiMode: "simple" | "expert" = "simple";
let currentSettingsTab: "proxy" | "rules" = "proxy";
let currentProxyConfig: ProxyConfig | undefined;
let editingRulePack: RulePackSetting | null = null;

type ToastTone = "success" | "error" | "warning" | "info";

function inferToastTone(message: string): ToastTone {
  if (/失败|异常|错误|无法|无效|超时/.test(message)) return "error";
  if (/必须|请填写|请先|未授予|相同/.test(message)) return "warning";
  if (/正在|读取|检测中|下载中/.test(message)) return "info";
  if (/成功|已保存|已更新|已开启|已关闭|更新完成|正常|健康/.test(message)) return "success";
  return "info";
}

function showToast(message: string, tone: ToastTone = inferToastTone(message)): void {
  const text = message.trim();
  if (!text) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");

  const dot = document.createElement("span");
  dot.className = "toast-dot";
  dot.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.className = "toast-copy";
  copy.textContent = text;

  toast.append(dot, copy);
  toastHostElement.append(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(() => toast.classList.add("is-leaving"), 2600);
  window.setTimeout(() => toast.remove(), 3200);
}

function bindTransientStatus(element: HTMLElement): void {
  const observer = new MutationObserver(() => {
    const next = element.textContent?.trim() ?? "";
    if (next) showToast(next);
  });
  observer.observe(element, { childList: true, characterData: true, subtree: true });
}

for (const element of [
  statusElement,
  rulePackStatusElement,
  fallbackStatusElement,
  autoRefreshStatusElement,
  diagnosticStatus,
  ruleMatchResult,
]) {
  bindTransientStatus(element);
}

interface NetworkRouteInfo {
  ip: string;
  requestMs: number;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  asn?: number;
}

interface NetworkInfoCache {
  host: string;
  port: number;
  checkedAt: string;
  direct?: NetworkRouteInfo;
  proxy?: NetworkRouteInfo;
  directError?: string;
  proxyError?: string;
  sameExitIp: boolean;
}

const PRESETS = {
  pinterest: {
    name: "Pinterest",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/pinterest.yaml",
  },
  github: {
    name: "GitHub",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml",
  },
} as const;

versionElement.textContent = chrome.runtime.getManifest().version;

function setProxyHealthState(
  state: "missing" | "unknown" | "checking" | "healthy" | "unhealthy",
): void {
  proxyConfigBadge.dataset.state = state;

  if (state === "healthy") {
    proxyConfigBadgeText.textContent = "健康";
    return;
  }

  if (state === "checking" || state === "unknown") {
    proxyConfigBadgeText.textContent = "检测中";
    return;
  }

  proxyConfigBadgeText.textContent = "异常";
}

function updateProxySummary(proxyConfig?: ProxyConfig): void {
  currentProxyConfig = proxyConfig;

  if (!proxyConfig) {
    setProxyHealthState("missing");
    refreshNetworkInfoButton.disabled = true;
    resetNetworkInfo("请先保存代理配置，再对比本地与代理出口。");
    return;
  }

  refreshNetworkInfoButton.disabled = false;
}

function formatNetworkLocation(info: NetworkRouteInfo): string {
  return [info.country, info.region, info.city]
    .filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index)
    .join(" · ") || "位置未知";
}

function formatNetworkProvider(info: NetworkRouteInfo): string {
  return [info.isp, info.asn ? `AS${info.asn}` : undefined]
    .filter(Boolean)
    .join(" · ") || "网络信息未知";
}

function formatLastChecked(checkedAt: string): string {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return "检测时间未知";

  return `最后检测 ${date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

function isNetworkInfoCacheForConfig(
  value: unknown,
  proxyConfig: ProxyConfig,
): value is NetworkInfoCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<NetworkInfoCache>;
  return cache.host === proxyConfig.host &&
    cache.port === proxyConfig.port &&
    typeof cache.checkedAt === "string" &&
    typeof cache.sameExitIp === "boolean";
}

function resetNetworkInfo(message = "尚未检测网络出口"): void {
  directExitIpElement.textContent = "—";
  directExitLocationElement.textContent = "—";
  directExitNetworkElement.textContent = "—";
  directExitTimeElement.textContent = "";
  proxyExitIpElement.textContent = "—";
  proxyExitLocationElement.textContent = "—";
  proxyExitNetworkElement.textContent = "—";
  proxyExitTimeElement.textContent = "";
  networkLastCheckedElement.textContent = "尚未检测";
  delete networkRouteSummaryElement.dataset.state;
  networkRouteSummaryElement.textContent = message;
}

function renderNetworkInfo(
  result: Pick<NetworkInfoCache,
    "direct" | "proxy" | "directError" | "proxyError" | "sameExitIp" | "checkedAt">,
  announce = false,
): void {
  const { direct, proxy, directError, proxyError, sameExitIp, checkedAt } = result;

  if (direct) {
    directExitIpElement.textContent = direct.ip;
    directExitLocationElement.textContent = formatNetworkLocation(direct);
    directExitNetworkElement.textContent = formatNetworkProvider(direct);
    directExitTimeElement.textContent = `请求 ${Math.max(1, Math.round(direct.requestMs))} ms`;
  } else {
    directExitIpElement.textContent = "获取失败";
    directExitLocationElement.textContent = "—";
    directExitNetworkElement.textContent = directError ?? "直连出口查询失败";
    directExitTimeElement.textContent = "";
  }

  if (proxy) {
    proxyExitIpElement.textContent = proxy.ip;
    proxyExitLocationElement.textContent = formatNetworkLocation(proxy);
    proxyExitNetworkElement.textContent = formatNetworkProvider(proxy);
    proxyExitTimeElement.textContent = `请求 ${Math.max(1, Math.round(proxy.requestMs))} ms`;
  } else {
    proxyExitIpElement.textContent = "获取失败";
    proxyExitLocationElement.textContent = "—";
    proxyExitNetworkElement.textContent = proxyError ?? "代理出口查询失败";
    proxyExitTimeElement.textContent = "";
  }

  networkLastCheckedElement.textContent = formatLastChecked(checkedAt);
  delete networkRouteSummaryElement.dataset.state;
  networkRouteSummaryElement.textContent =
    "仅当本地直连与代理出口都成功获取，且公网 IP 不一致时判定为健康。";

  // 产品定义：只有代理确实改变公网出口时，才判定为健康。
  if (proxy && direct && !sameExitIp) {
    setProxyHealthState("healthy");
    if (announce) showToast("代理健康：公网出口已发生变化。", "success");
    return;
  }

  setProxyHealthState("unhealthy");
  if (!announce) return;

  if (proxy && direct && sameExitIp) {
    showToast("代理异常：代理出口与本地直连 IP 相同。", "error");
  } else if (!direct && proxy) {
    showToast("代理异常：无法获取本地直连 IP，不能完成出口差异验证。", "error");
  } else if (direct && !proxy) {
    showToast("代理异常：无法获取代理出口 IP。", "error");
  } else {
    showToast("代理异常：本地直连和代理出口 IP 均获取失败。", "error");
  }
}

async function saveNetworkInfoCache(cache: NetworkInfoCache): Promise<void> {
  await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });
}

async function refreshNetworkInfo(showProgressToast = true): Promise<void> {
  if (!currentProxyConfig || refreshNetworkInfoButton.dataset.running === "true") {
    if (!currentProxyConfig) showToast("请先保存代理地址和端口", "warning");
    return;
  }

  const proxyConfig = { ...currentProxyConfig };
  refreshNetworkInfoButton.disabled = true;
  refreshNetworkInfoButton.dataset.running = "true";
  refreshNetworkInfoButton.textContent = "检测中";
  setProxyHealthState("checking");

  if (showProgressToast) {
    showToast("正在对比本地直连与代理出口…", "info");
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_NETWORK_INFO",
    }) as {
      ok: boolean;
      data?: {
        direct?: NetworkRouteInfo;
        proxy?: NetworkRouteInfo;
        directError?: string;
        proxyError?: string;
        sameExitIp: boolean;
        proxyEndpoint?: string;
      };
      message?: string;
      error?: string;
    };

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "网络信息检测失败");
    }

    const checkedAt = new Date().toISOString();
    const cache: NetworkInfoCache = {
      host: proxyConfig.host,
      port: proxyConfig.port,
      checkedAt,
      direct: response.data.direct,
      proxy: response.data.proxy,
      directError: response.data.directError,
      proxyError: response.data.proxyError,
      sameExitIp: response.data.sameExitIp,
    };

    // 如果检测过程中用户已经保存了另一个代理地址，不让旧结果覆盖新节点。
    if (!currentProxyConfig ||
        currentProxyConfig.host !== proxyConfig.host ||
        currentProxyConfig.port !== proxyConfig.port) {
      return;
    }

    await saveNetworkInfoCache(cache);
    renderNetworkInfo(cache, showProgressToast);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "网络信息检测失败";
    const cache: NetworkInfoCache = {
      host: proxyConfig.host,
      port: proxyConfig.port,
      checkedAt: new Date().toISOString(),
      directError: message,
      proxyError: message,
      sameExitIp: false,
    };

    if (currentProxyConfig &&
        currentProxyConfig.host === proxyConfig.host &&
        currentProxyConfig.port === proxyConfig.port) {
      await saveNetworkInfoCache(cache);
      renderNetworkInfo(cache, false);
      if (showProgressToast) showToast(message, "error");
    }
  } finally {
    refreshNetworkInfoButton.disabled = !currentProxyConfig;
    refreshNetworkInfoButton.dataset.running = "false";
    refreshNetworkInfoButton.textContent = "刷新";
  }
}
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
  const total = rulePackListElement.querySelectorAll(".rule-pack-card").length;
  rulePackCountElement.textContent =
    `${enabledIds.length}/${total} 已启用`;
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
    throw new Error(response.error ?? "规则应用失败");
  }

  updateRulePackCount(enabledIds);
  rulePackStatusElement.textContent =
    response.message ?? "规则已保存";
}

function activateTab(tabId: string): void {
  const resolvedTabId = tabId === "rules" ? "rules" : "proxy";
  currentSettingsTab = resolvedTabId;

  aboutPanel.hidden = true;
  aboutButton.classList.remove("active");
  aboutButton.setAttribute("aria-pressed", "false");

for (const button of tabButtons) {
    const active = button.dataset.tabTarget === resolvedTabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== resolvedTabId;
  }

}

function openAbout(): void {
  for (const button of tabButtons) {
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
  }

  for (const panel of tabPanels) {
    panel.hidden = true;
  }

  aboutPanel.hidden = false;
  aboutButton.classList.add("active");
  aboutButton.setAttribute("aria-pressed", "true");
}

function applyUiMode(mode: "simple" | "expert"): void {
  currentUiMode = mode;
  rulesPanel.dataset.uiCurrent = mode;
  modeDescriptionElement.textContent = mode === "simple"
    ? "选择常用网站并开启即可，其余规则由预设维护。"
    : "管理远程订阅、本地规则与连接策略。";

  if (mode === "simple") {
    ruleMatchResult.textContent = "";
  }

  for (const button of modeButtons) {
    button.classList.toggle("active", button.dataset.uiMode === mode);
  }
}

function findPresetRule(
  presetId: keyof typeof PRESETS,
  settings: readonly RulePackSetting[] = renderedRulePackSettings,
): RulePackSetting | undefined {
  const preset = PRESETS[presetId];
  return settings.find(
    (pack) => pack.defaultUrl === preset.url || pack.source.url === preset.url,
  );
}

function syncPresetControls(settings: readonly RulePackSetting[]): void {
for (const control of presetControls) {
    const presetId = control.dataset.preset as keyof typeof PRESETS;
    control.checked = findPresetRule(presetId, settings)?.simpleEnabled === true;
  }
}

async function setPresetEnabled(
  presetId: keyof typeof PRESETS,
  enabled: boolean,
): Promise<void> {
  const preset = PRESETS[presetId];
  const existing = findPresetRule(presetId);
  let packId = existing?.id;

  if (enabled && !packId) {
    const saved = await chrome.runtime.sendMessage({
      type: "SAVE_RULE_PACK",
      name: preset.name,
      url: preset.url,
      action: "PROXY",
      customContent: "",
      sourceStrategy: "merge",
    }) as { ok: boolean; data?: { packId: string }; error?: string };

    if (!saved.ok || !saved.data?.packId) {
      throw new Error(saved.error ?? `${preset.name} 添加失败`);
    }
    packId = saved.data.packId;
  }

  const currentEnabledIds = renderedRulePackSettings
    .filter((pack) => pack.simpleEnabled)
    .map((pack) => pack.id);
  const enabledIds = enabled && packId
    ? [...new Set([...currentEnabledIds, packId])]
    : currentEnabledIds.filter((id) => id !== packId);
  const response = await chrome.runtime.sendMessage({
    type: "UPDATE_SIMPLE_RULE_PACKS",
    enabledPackIds: enabledIds,
  }) as { ok: boolean; message?: string; error?: string };

  if (!response.ok) {
    throw new Error(response.error ?? `${preset.name} 启用失败`);
  }

  await loadStoredData();
  rulePackStatusElement.textContent =
    `${preset.name} 已${enabled ? "开启" : "关闭"}`;
}

interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}

async function loadDiagnostics(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "GET_DIAGNOSTIC_EVENTS",
  }) as { ok: boolean; data?: DiagnosticEvent[]; error?: string };

  if (!response.ok) {
    throw new Error(response.error ?? "诊断记录读取失败");
  }

  const events = response.data ?? [];

  if (events.length === 0) {
    diagnosticList.textContent = "暂无诊断记录";
    return;
  }

  const fragment = document.createDocumentFragment();
  const typeLabels = {
    proxy: "代理",
    subscription: "订阅",
    background: "后台",
  };

  for (const item of events) {
    const row = document.createElement("article");
    const title = document.createElement("strong");
    const time = document.createElement("time");
    const details = document.createElement("small");
    title.textContent = `[${typeLabels[item.type]}] ${item.message}`;
    time.dateTime = item.occurredAt;
    time.textContent = new Date(item.occurredAt).toLocaleString("zh-CN");
    details.textContent = item.details || "无更多信息";
    row.append(title, time, details);
    fragment.append(row);
  }

  diagnosticList.replaceChildren(fragment);
}

const FALLBACK_DESCRIPTIONS: Record<FallbackMode, string> = {
  direct: "未命中规则的网站由 Chrome 直接连接。",
  proxy: "未命中规则的网站全部使用当前局域网 HTTP 代理。",
  system: "交还 Chrome 系统代理模式；自定义规则分流会暂停。",
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

async function requestUrlPermission(url: string): Promise<void> {
  if (!url.trim()) {
    return;
  }

  const parsed = new URL(url);

  if (parsed.hostname === "raw.githubusercontent.com") {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: [`${parsed.origin}/*`],
  });

  if (!granted) {
    throw new Error("未授予该订阅地址的访问权限");
  }
}

function formatRuleUpdate(pack: RulePackSetting): string {
  const timestamps = [pack.source.updatedAt, pack.source.modifiedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));

  if (timestamps.length === 0) {
    return "尚未更新";
  }

  const date = timestamps.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest);

  return `最后更新 ${date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getSourceStrategy(pack: RulePackSetting): SourceStrategy {
  const strategy = pack.sourceStrategy ?? pack.source.sourceStrategy;
  return strategy === "local-first" ||
      strategy === "subscription-first" ||
      strategy === "merge"
    ? strategy
    : "merge";
}

function formatRuleEditorMeta(pack: RulePackSetting): string {
  if (pack.source.status === "cached" && pack.source.error) {
    return `更新失败，正在使用现有规则：${pack.source.error}`;
  }
  if (pack.source.error) {
    return `下载错误：${pack.source.error}`;
  }
  if (pack.source.updatedAt) {
    return `最近更新：${new Date(pack.source.updatedAt).toLocaleString("zh-CN")}`;
  }
  return pack.id ? "尚未下载" : "保存后可立即下载远程订阅";
}

function openRuleEditor(pack?: RulePackSetting): void {
  editingRulePack = pack ?? {
    id: "",
    name: "",
    description: "自定义远程规则",
    defaultUrl: "",
    defaultAction: "PROXY",
    enabled: false,
    sourceStrategy: "merge",
    source: {},
  };

  ruleEditorTitle.textContent = editingRulePack.id ? "编辑规则" : "添加规则";
  ruleEditorNameInput.value = editingRulePack.name;
  ruleEditorUrlInput.value = editingRulePack.source.url || editingRulePack.defaultUrl;
  ruleEditorActionSelect.value = editingRulePack.defaultAction;
  ruleEditorSourceStrategySelect.value = getSourceStrategy(editingRulePack);
  ruleEditorContent.value = editingRulePack.source.customContent || "";
  ruleEditorMeta.textContent = formatRuleEditorMeta(editingRulePack);
  ruleEditorDeleteButton.hidden = !editingRulePack.id;
  ruleEditorRefreshButton.disabled = !editingRulePack.id ||
    !(editingRulePack.source.url || editingRulePack.defaultUrl).trim();

  if (!ruleEditorDialog.open) {
    ruleEditorDialog.showModal();
  }
  requestAnimationFrame(() => ruleEditorNameInput.focus());
}

function closeRuleEditor(): void {
  editingRulePack = null;
  if (ruleEditorDialog.open) {
    ruleEditorDialog.close();
  }
}

async function saveRuleEditor(): Promise<void> {
  if (!editingRulePack) return;

  const name = ruleEditorNameInput.value.trim();
  const url = ruleEditorUrlInput.value.trim();
  const customContent = ruleEditorContent.value;
  const action = ruleEditorActionSelect.value as "DIRECT" | "PROXY";
  const sourceStrategy = ruleEditorSourceStrategySelect.value as SourceStrategy;

  if (!name) {
    ruleEditorMeta.textContent = "请填写规则名称。";
    ruleEditorNameInput.focus();
    return;
  }

  if (!url && !customContent.trim()) {
    ruleEditorMeta.textContent = "订阅地址和本地规则内容至少填写一项。";
    return;
  }

  await requestUrlPermission(url);
  ruleEditorMeta.textContent = "正在保存…";

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_RULE_PACK",
    packId: editingRulePack.id || undefined,
    name,
    url,
    action,
    customContent,
    sourceStrategy,
  }) as {
    ok: boolean;
    data?: { packId: string };
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "保存失败");
  }


  closeRuleEditor();
  await loadStoredData();
  rulePackStatusElement.textContent = response.message ?? "规则已保存";
}

async function refreshEditingRule(): Promise<void> {
  if (!editingRulePack?.id) return;

  const url = ruleEditorUrlInput.value.trim();
  await requestUrlPermission(url);
  ruleEditorRefreshButton.disabled = true;
  ruleEditorMeta.textContent = "正在下载订阅…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REFRESH_RULE_PACK",
      packId: editingRulePack.id,
    }) as { ok: boolean; message?: string; error?: string };

    if (!response.ok) {
      throw new Error(response.error ?? "下载失败");
    }

    await loadStoredData();
    const refreshed = renderedRulePackSettings.find((item) => item.id === editingRulePack?.id);
    if (refreshed) {
      editingRulePack = refreshed;
      ruleEditorMeta.textContent = formatRuleEditorMeta(refreshed);
    } else {
      ruleEditorMeta.textContent = response.message ?? "下载成功";
    }
  } finally {
    ruleEditorRefreshButton.disabled = false;
  }
}

async function deleteEditingRule(): Promise<void> {
  if (!editingRulePack?.id) {
    closeRuleEditor();
    return;
  }

  const packId = editingRulePack.id;
  ruleEditorDeleteButton.disabled = true;
  ruleEditorMeta.textContent = "正在删除…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DELETE_RULE_PACK",
      packId,
    }) as { ok: boolean; message?: string; error?: string };

    if (!response.ok) {
      throw new Error(response.error ?? "删除失败");
    }


    closeRuleEditor();
    await loadStoredData();
    rulePackStatusElement.textContent = response.message ?? "规则已删除";
  } finally {
    ruleEditorDeleteButton.disabled = false;
  }
}

async function saveAutoRefreshSettings(): Promise<void> {
  const enabled = autoRefreshEnabledElement.checked;
  const intervalHours = Number(autoRefreshIntervalElement.value);
  autoRefreshIntervalElement.disabled = !enabled;
  autoRefreshStatusElement.textContent = "正在保存…";

  const response = await chrome.runtime.sendMessage({
    type: "UPDATE_RULE_AUTO_REFRESH",
    enabled,
    intervalHours,
  }) as {
    ok: boolean;
    data?: {
      enabled: boolean;
      intervalHours: number;
    };
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "自动更新设置保存失败");
  }

  autoRefreshStatusElement.textContent =
    response.message ?? (enabled ? "自动更新已开启" : "自动更新已关闭");
}

function renderRulePacks(settings: readonly RulePackSetting[]): void {
  renderedRulePackSettings = [...settings];
  syncPresetControls(settings);
  const fragment = document.createDocumentFragment();

  for (const pack of settings) {
    const card = document.createElement("article");
    card.className = "rule-pack-card";
    card.dataset.packId = pack.id;

    const row = document.createElement("div");
    row.className = "rule-pack-item";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "rule-pack-open";
    openButton.setAttribute("aria-label", `编辑 ${pack.name || "规则"}`);
    openButton.addEventListener("click", () => openRuleEditor(pack));

    const titleLine = document.createElement("span");
    titleLine.className = "rule-pack-title-line";
    const name = document.createElement("strong");
    name.textContent = pack.name || "未命名规则";
    const countBadge = document.createElement("span");
    countBadge.className = "rule-count-badge";
    countBadge.textContent = pack.validation ? String(pack.validation.effective) : "—";
    countBadge.title = pack.validation
      ? `${pack.validation.effective} 条有效规则` +
        (pack.validation.ignored > 0 ? `，忽略 ${pack.validation.ignored} 条` : "")
      : "有效规则数尚未统计";
    titleLine.append(name, countBadge);

    const meta = document.createElement("span");
    meta.className = "rule-pack-meta";
    const actionLabel = pack.defaultAction === "PROXY" ? "局域网代理" : "本地直连";
    meta.textContent = `${formatRuleUpdate(pack)} · ${actionLabel}`;
    openButton.append(titleLine, meta);

    const ruleToggle = document.createElement("label");
    ruleToggle.className = "rule-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = pack.id;
    checkbox.checked = pack.enabled;
    checkbox.disabled = !pack.id;
    checkbox.setAttribute("aria-label", `启用 ${pack.name || "规则"}`);
    checkbox.addEventListener("change", () => {
      void saveRulePackSelection().catch((error: unknown) => {
        console.error(error);
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "规则保存失败";
      });
    });

    const switchTrack = document.createElement("span");
    switchTrack.setAttribute("aria-hidden", "true");
    ruleToggle.append(checkbox, switchTrack);
    row.append(openButton, ruleToggle);
    card.append(row);
    fragment.append(card);
  }

  rulePackListElement.replaceChildren(fragment);
  updateRulePackCount(settings.filter((pack) => pack.enabled).map((pack) => pack.id));
}

async function loadStoredData(): Promise<void> {
  const [result, rulePackResponse] = await Promise.all([
    chrome.storage.local.get([
      INSTALL_TIME_KEY,
      PROXY_CONFIG_KEY,
      ENABLED_RULE_PACK_IDS_KEY,
      SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
      FALLBACK_MODE_KEY,
      UI_MODE_KEY,
      ACTIVE_TAB_KEY,
      AUTO_REFRESH_ENABLED_KEY,
      AUTO_REFRESH_INTERVAL_KEY,
      NETWORK_INFO_CACHE_KEY,
    ]),
    chrome.runtime.sendMessage({ type: "GET_RULE_PACK_SETTINGS" }) as Promise<{
      ok: boolean;
      data?: RulePackSetting[];
      error?: string;
    }>,
  ]);

  const installedAt = result[INSTALL_TIME_KEY] as string | undefined;
  const proxyConfig = result[PROXY_CONFIG_KEY] as ProxyConfig | undefined;
  const storedEnabledIds = result[ENABLED_RULE_PACK_IDS_KEY] as unknown;
  const enabledIds = Array.isArray(storedEnabledIds)
    ? storedEnabledIds.filter((id): id is string => typeof id === "string")
    : [...DEFAULT_ENABLED_RULE_PACK_IDS];
  const storedFallbackMode = result[FALLBACK_MODE_KEY] as unknown;
  const storedUiMode = result[UI_MODE_KEY] as unknown;
  const storedActiveTab = result[ACTIVE_TAB_KEY] as unknown;
  const storedAutoRefreshEnabled = result[AUTO_REFRESH_ENABLED_KEY] === true;
  const storedAutoRefreshInterval = Number(result[AUTO_REFRESH_INTERVAL_KEY]);
  const resolvedAutoRefreshInterval = [6, 12, 24, 168].includes(storedAutoRefreshInterval)
    ? storedAutoRefreshInterval
    : 24;
  autoRefreshEnabledElement.checked = storedAutoRefreshEnabled;
  autoRefreshIntervalElement.value = String(resolvedAutoRefreshInterval);
  autoRefreshIntervalElement.disabled = !storedAutoRefreshEnabled;

  activateTab(storedActiveTab === "rules" ? "rules" : "proxy");
  applyUiMode(storedUiMode === "expert" ? "expert" : "simple");
  const fallbackMode: FallbackMode =
    storedFallbackMode === "proxy" || storedFallbackMode === "system"
      ? storedFallbackMode
      : "direct";

  renderRulePacks(rulePackResponse.ok && rulePackResponse.data
    ? rulePackResponse.data
    : DEFAULT_RULE_PACKS.map((pack) => ({
        ...pack,
        enabled: enabledIds.includes(pack.id),
        simpleEnabled: false,
        source: {},
      })));
  fallbackModeElement.value = fallbackMode;
  fallbackDescriptionElement.textContent =
    FALLBACK_DESCRIPTIONS[fallbackMode];

  installedAtElement.textContent = installedAt
    ? new Date(installedAt).toLocaleString("zh-CN")
    : "暂无记录";

  updateProxySummary(proxyConfig);

  if (!proxyConfig) {
    statusElement.textContent = "";
    return;
  }

  hostInput.value = proxyConfig.host;
  portInput.value = String(proxyConfig.port);

  const cachedNetworkInfo = result[NETWORK_INFO_CACHE_KEY] as unknown;
  if (isNetworkInfoCacheForConfig(cachedNetworkInfo, proxyConfig)) {
    renderNetworkInfo(cachedNetworkInfo, false);
  } else {
    setProxyHealthState("unhealthy");
    resetNetworkInfo("尚无此代理地址的检测结果；修改配置后会自动检测，也可以手动刷新。");
  }

  statusElement.textContent = "";
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
  const configChanged = !currentProxyConfig ||
    currentProxyConfig.host !== host ||
    currentProxyConfig.port !== port;

  await chrome.storage.local.set({
    [PROXY_CONFIG_KEY]: proxyConfig,
  });

  updateProxySummary(proxyConfig);

  if (!configChanged) {
    statusElement.textContent = "代理设置未变化，保留上次检测结果";
    return;
  }

  await chrome.storage.local.remove(NETWORK_INFO_CACHE_KEY);
  setProxyHealthState("checking");
  resetNetworkInfo("代理配置已变化，正在获取新的出口信息。");
  statusElement.textContent = `已保存：http://${host}:${port}`;
  void refreshNetworkInfo(false);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  void saveProxyConfig().catch((error: unknown) => {
    console.error(error);

    statusElement.textContent =
      error instanceof Error ? error.message : "保存失败";
  });
});

refreshNetworkInfoButton.addEventListener("click", () => {
  void refreshNetworkInfo();
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;

    if (target === "proxy" || target === "rules") {
      activateTab(target);
      void chrome.storage.local.set({ [ACTIVE_TAB_KEY]: target });
    }
  });
}

aboutButton.addEventListener("click", () => {
  openAbout();
  void loadDiagnostics().catch((error: unknown) => {
    diagnosticStatus.textContent =
      error instanceof Error ? error.message : "诊断记录读取失败";
  });
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.uiMode === "expert" ? "expert" : "simple";
    if (mode === currentUiMode) return;

    const previousMode = currentUiMode;
    applyUiMode(mode);
    renderRulePacks(renderedRulePackSettings);
    for (const item of modeButtons) item.disabled = true;

    void chrome.runtime.sendMessage({
      type: "UPDATE_UI_MODE",
      mode,
    }).then((response: { ok: boolean; message?: string; error?: string }) => {
      if (!response.ok) {
        throw new Error(response.error ?? "模式切换失败");
      }
      showToast(
        response.message ?? (mode === "simple" ? "已切换到简易模式" : "已切换到高级模式"),
        "success",
      );
    }).catch((error: unknown) => {
      applyUiMode(previousMode);
      renderRulePacks(renderedRulePackSettings);
      showToast(error instanceof Error ? error.message : "模式切换失败", "error");
    }).finally(() => {
      for (const item of modeButtons) item.disabled = false;
    });
  });
}

for (const control of presetControls) {
  control.addEventListener("change", () => {
    const presetId = control.dataset.preset as keyof typeof PRESETS;
    const enabled = control.checked;
    control.disabled = true;
    rulePackStatusElement.textContent =
      `正在${enabled ? "开启" : "关闭"} ${PRESETS[presetId].name}…`;
    void setPresetEnabled(presetId, enabled)
      .catch((error: unknown) => {
        control.checked = !enabled;
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "预设操作失败";
      })
      .finally(() => {
        control.disabled = false;
      });
  });
}

autoRefreshEnabledElement.addEventListener("change", () => {
  void saveAutoRefreshSettings().catch((error: unknown) => {
    autoRefreshStatusElement.textContent =
      error instanceof Error ? error.message : "自动更新设置保存失败";
  });
});

autoRefreshIntervalElement.addEventListener("change", () => {
  void saveAutoRefreshSettings().catch((error: unknown) => {
    autoRefreshStatusElement.textContent =
      error instanceof Error ? error.message : "自动更新设置保存失败";
  });
});

ruleEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveRuleEditor().catch((error: unknown) => {
    ruleEditorMeta.textContent =
      error instanceof Error ? error.message : "保存失败";
  });
});

ruleEditorCloseButton.addEventListener("click", closeRuleEditor);
ruleEditorCancelButton.addEventListener("click", closeRuleEditor);
ruleEditorRefreshButton.addEventListener("click", () => {
  void refreshEditingRule().catch((error: unknown) => {
    ruleEditorMeta.textContent =
      error instanceof Error ? error.message : "下载失败";
    ruleEditorRefreshButton.disabled = false;
  });
});
ruleEditorDeleteButton.addEventListener("click", () => {
  void deleteEditingRule().catch((error: unknown) => {
    ruleEditorMeta.textContent =
      error instanceof Error ? error.message : "删除失败";
    ruleEditorDeleteButton.disabled = false;
  });
});
ruleEditorDialog.addEventListener("click", (event) => {
  if (event.target === ruleEditorDialog) {
    closeRuleEditor();
  }
});

fallbackModeElement.addEventListener("change", () => {
  void saveFallbackMode().catch((error: unknown) => {
    console.error(error);
    fallbackStatusElement.textContent =
      error instanceof Error ? error.message : "兜底策略保存失败";
  });
});

clearDiagnosticsButton.addEventListener("click", () => {
  clearDiagnosticsButton.disabled = true;
  void chrome.runtime.sendMessage({ type: "CLEAR_DIAGNOSTIC_EVENTS" })
    .then(async (response: { ok: boolean; message?: string; error?: string }) => {
      if (!response.ok) {
        throw new Error(response.error ?? "清除失败");
      }
      await loadDiagnostics();
      diagnosticStatus.textContent = response.message ?? "诊断记录已清除";
    })
    .catch((error: unknown) => {
      diagnosticStatus.textContent =
        error instanceof Error ? error.message : "清除失败";
    })
    .finally(() => {
      clearDiagnosticsButton.disabled = false;
    });
});

addRulePackButton.addEventListener("click", () => {
  openRuleEditor();
});

refreshEnabledRulesButton.addEventListener("click", () => {
  refreshEnabledRulesButton.disabled = true;
  rulePackStatusElement.textContent = "正在更新已启用的远程规则…";

  void chrome.runtime.sendMessage({
    type: "REFRESH_ENABLED_RULE_PACKS",
  }).then(async (response: { ok: boolean; message?: string; error?: string }) => {
    if (!response.ok) {
      throw new Error(response.error ?? "批量更新失败");
    }

    await loadStoredData();
    rulePackStatusElement.textContent = response.message ?? "规则更新完成";
  }).catch((error: unknown) => {
    rulePackStatusElement.textContent =
      error instanceof Error ? error.message : "批量更新失败";
  }).finally(() => {
    refreshEnabledRulesButton.disabled = false;
  });
});

ruleMatchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ruleMatchResult.textContent = "正在匹配…";

  void chrome.runtime.sendMessage({
    type: "TEST_RULE_MATCH",
    input: ruleMatchInput.value,
  }).then((response: {
    ok: boolean;
    data?: {
      hostname: string;
      action: "DIRECT" | "PROXY" | "SYSTEM";
      matched: boolean;
      rule?: { type: string; value: string };
    };
    error?: string;
  }) => {
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "规则匹配失败");
    }

    const actionLabel = {
      DIRECT: "本地直连",
      PROXY: "局域网代理",
      SYSTEM: "系统代理",
    }[response.data.action];
    ruleMatchResult.textContent = response.data.matched && response.data.rule
      ? `${response.data.hostname} → ${actionLabel}；命中 ${response.data.rule.type},${response.data.rule.value}`
      : `${response.data.hostname} → ${actionLabel}；未命中规则，使用兜底策略`;
  }).catch((error: unknown) => {
    ruleMatchResult.textContent =
      error instanceof Error ? error.message : "规则匹配失败";
  });
});

void loadStoredData()
  .catch((error: unknown) => {
    console.error(error);

    statusElement.textContent =
      error instanceof Error ? error.message : "读取配置失败";
  })
  .finally(() => {
    requestAnimationFrame(lockInitialCardHeight);
  });
