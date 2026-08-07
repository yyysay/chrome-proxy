import "./settings.css";

const INSTALL_TIME_KEY = "installedAt";
const ACTIVE_TAB_KEY = "activeSettingsTab";
const AUTO_REFRESH_ENABLED_KEY = "autoRuleRefreshEnabled";
const AUTO_REFRESH_INTERVAL_KEY = "autoRuleRefreshIntervalHours";
const NETWORK_INFO_CACHE_KEY = "networkInfoCache";
const FALLBACK_MODE_KEY = "fallbackMode";

type SourceStrategy = "local-first" | "subscription-first" | "merge";
type ProxySourceMode = "subscription" | "manual";
type EffectiveProxySource = "subscription" | "manual" | "fallback";
type FallbackMode = "direct" | "proxy" | "system";

type ToastTone = "success" | "error" | "warning" | "info";

interface ProxyNode {
  id: string;
  name: string;
  type: "http";
  host: string;
  port: number;
}

interface ProxyProviderState {
  sourceMode: ProxySourceMode;
  effectiveSource: EffectiveProxySource;
  subscriptionUrl: string;
  activeProxy: ProxyNode;
  proxies: ProxyNode[];
  manualOverride?: ProxyNode;
  subscription?: {
    url: string;
    document: { version: 1; updatedAt?: string; proxies: ProxyNode[] };
    fetchedAt: string;
    lastAttemptAt: string;
    status: "ready" | "cached";
    error?: string;
  };
  subscriptionError?: string;
}

interface RulePackSetting {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  defaultAction: "DIRECT" | "PROXY";
  managed: boolean;
  customized?: boolean;
  enabled: boolean;
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
  validation?: { effective: number; ignored: number };
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

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: string;
}

interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少必要元素：${selector}`);
  return element;
}

const proxyHealthBadge = requiredElement<HTMLElement>("#proxy-health-badge");
const proxyHealthText = requiredElement<HTMLElement>("#proxy-health-text");
const subscriptionRadio = requiredElement<HTMLInputElement>("#proxy-source-subscription");
const manualRadio = requiredElement<HTMLInputElement>("#proxy-source-manual");
const subscriptionSettings = requiredElement<HTMLElement>("#subscription-settings");
const manualSettings = requiredElement<HTMLElement>("#manual-settings");
const subscriptionForm = requiredElement<HTMLFormElement>("#subscription-form");
const subscriptionUrlInput = requiredElement<HTMLInputElement>("#subscription-url");
const subscriptionStateBadge = requiredElement<HTMLElement>("#subscription-state-badge");
const subscriptionMeta = requiredElement<HTMLElement>("#subscription-meta");
const refreshProxySubscriptionButton = requiredElement<HTMLButtonElement>("#refresh-proxy-subscription");
const manualProxyForm = requiredElement<HTMLFormElement>("#manual-proxy-form");
const manualHostInput = requiredElement<HTMLInputElement>("#manual-proxy-host");
const manualPortInput = requiredElement<HTMLInputElement>("#manual-proxy-port");
const activeProxyTitle = requiredElement<HTMLElement>("#active-proxy-title");
const activeProxyEndpoint = requiredElement<HTMLElement>("#active-proxy-endpoint");
const refreshNetworkInfoButton = requiredElement<HTMLButtonElement>("#refresh-network-info");
const networkLastChecked = requiredElement<HTMLElement>("#network-last-checked");
const networkRouteSummary = requiredElement<HTMLElement>("#network-route-summary");
const directExitIp = requiredElement<HTMLElement>("#direct-exit-ip");
const directExitLocation = requiredElement<HTMLElement>("#direct-exit-location");
const directExitNetwork = requiredElement<HTMLElement>("#direct-exit-network");
const directExitTime = requiredElement<HTMLElement>("#direct-exit-time");
const proxyExitIp = requiredElement<HTMLElement>("#proxy-exit-ip");
const proxyExitLocation = requiredElement<HTMLElement>("#proxy-exit-location");
const proxyExitNetwork = requiredElement<HTMLElement>("#proxy-exit-network");
const proxyExitTime = requiredElement<HTMLElement>("#proxy-exit-time");
const managedRuleCount = requiredElement<HTMLElement>("#managed-rule-count");
const managedRuleList = requiredElement<HTMLElement>("#managed-rule-list");
const manageManagedRulesButton = requiredElement<HTMLButtonElement>("#manage-managed-rules");
const managedRulesDialog = requiredElement<HTMLDialogElement>("#managed-rules-dialog");
const managedRulesCloseButton = requiredElement<HTMLButtonElement>("#managed-rules-close");
const customRuleList = requiredElement<HTMLElement>("#custom-rule-list");
const customRuleEmpty = requiredElement<HTMLElement>("#custom-rule-empty");
const fallbackModeElement = requiredElement<HTMLSelectElement>("#fallback-mode");
const fallbackDescriptionElement = requiredElement<HTMLElement>("#fallback-description");
const addRulePackButton = requiredElement<HTMLButtonElement>("#add-rule-pack");
const refreshEnabledRulesButton = requiredElement<HTMLButtonElement>("#refresh-enabled-rules");
const ruleMatchForm = requiredElement<HTMLFormElement>("#rule-match-form");
const ruleMatchInput = requiredElement<HTMLInputElement>("#rule-match-input");
const autoRefreshEnabled = requiredElement<HTMLInputElement>("#auto-refresh-enabled");
const autoRefreshInterval = requiredElement<HTMLSelectElement>("#auto-refresh-interval");
const aboutButton = requiredElement<HTMLButtonElement>("#about-button");
const aboutPanel = requiredElement<HTMLElement>('[data-view-panel="about"]');
const versionElement = requiredElement<HTMLElement>("#version");
const installedAtElement = requiredElement<HTMLElement>("#installed-at");
const diagnosticList = requiredElement<HTMLElement>("#diagnostic-list");
const clearDiagnosticsButton = requiredElement<HTMLButtonElement>("#clear-diagnostics");
const toastHost = requiredElement<HTMLElement>("#toast-host");
const ruleEditorDialog = requiredElement<HTMLDialogElement>("#rule-editor-dialog");
const ruleEditorForm = requiredElement<HTMLFormElement>("#rule-editor-form");
const ruleEditorTitle = requiredElement<HTMLElement>("#rule-editor-title");
const ruleEditorKicker = requiredElement<HTMLElement>("#rule-editor-kicker");
const ruleEditorHint = requiredElement<HTMLElement>("#rule-editor-hint");
const ruleEditorCloseButton = requiredElement<HTMLButtonElement>("#rule-editor-close");
const ruleEditorCancelButton = requiredElement<HTMLButtonElement>("#rule-editor-cancel");
const ruleEditorDeleteButton = requiredElement<HTMLButtonElement>("#rule-editor-delete");
const ruleEditorRefreshButton = requiredElement<HTMLButtonElement>("#rule-editor-refresh");
const ruleEditorNameInput = requiredElement<HTMLInputElement>("#rule-editor-name");
const ruleEditorUrlInput = requiredElement<HTMLInputElement>("#rule-editor-url");
const ruleEditorActionSelect = requiredElement<HTMLSelectElement>("#rule-editor-action");
const ruleEditorSourceStrategySelect = requiredElement<HTMLSelectElement>("#rule-editor-source-strategy");
const ruleEditorContent = requiredElement<HTMLTextAreaElement>("#rule-editor-content");
const ruleEditorMeta = requiredElement<HTMLElement>("#rule-editor-meta");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));

let providerState: ProxyProviderState | undefined;
let rulePackSettings: RulePackSetting[] = [];
let editingRulePack: RulePackSetting | null = null;
let currentSettingsTab: "proxy" | "rules" = "proxy";

versionElement.textContent = chrome.runtime.getManifest().version;

function inferToastTone(message: string): ToastTone {
  if (/失败|异常|错误|无法|无效|超时/.test(message)) return "error";
  if (/回退|缓存|未配置|相同|请先/.test(message)) return "warning";
  if (/正在|读取|检测|下载/.test(message)) return "info";
  return "success";
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
  toastHost.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(() => toast.classList.add("is-leaving"), 2600);
  window.setTimeout(() => toast.remove(), 3200);
}

async function sendMessage<T>(message: object): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

function endpoint(node: ProxyNode): string {
  return `http://${node.host}:${node.port}`;
}

function endpointChanged(before: ProxyProviderState | undefined, after: ProxyProviderState): boolean {
  return !before || before.activeProxy.host !== after.activeProxy.host ||
    before.activeProxy.port !== after.activeProxy.port;
}

function validateHost(host: string): boolean {
  return Boolean(host) && !host.includes("://") && !host.includes("/");
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatSubscriptionBadgeTime(value?: string): string {
  if (!value) return "待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待更新";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatLastChecked(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "检测时间未知";
  return `最后检测 ${date.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  })}`;
}

function formatNetworkLocation(info: NetworkRouteInfo): string {
  return [info.country, info.region, info.city]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" · ") || "位置未知";
}

function formatNetworkProvider(info: NetworkRouteInfo): string {
  return [info.isp, info.asn ? `AS${info.asn}` : undefined].filter(Boolean).join(" · ") || "网络信息未知";
}

function setHealth(healthy: boolean, checking = false): void {
  proxyHealthBadge.dataset.state = checking ? "checking" : healthy ? "healthy" : "unhealthy";
  proxyHealthText.textContent = checking ? "检测中" : healthy ? "健康" : "异常";
}

function cacheMatchesActive(cache: unknown, state: ProxyProviderState): cache is NetworkInfoCache {
  if (!cache || typeof cache !== "object") return false;
  const value = cache as Partial<NetworkInfoCache>;
  return value.host === state.activeProxy.host && value.port === state.activeProxy.port &&
    typeof value.checkedAt === "string";
}

function resetNetworkInfo(message = "尚无当前代理节点的检测结果。", state: "healthy" | "unhealthy" | undefined = undefined): void {
  directExitIp.textContent = "—";
  directExitLocation.textContent = "—";
  directExitNetwork.textContent = "—";
  directExitTime.textContent = "";
  proxyExitIp.textContent = "—";
  proxyExitLocation.textContent = "—";
  proxyExitNetwork.textContent = "—";
  proxyExitTime.textContent = "";
  networkLastChecked.textContent = "尚未检测";
  networkRouteSummary.textContent = message;
  if (state) networkRouteSummary.dataset.state = state;
  else delete networkRouteSummary.dataset.state;
  setHealth(false);
}

function renderNetworkInfo(cache: NetworkInfoCache): void {
  const direct = cache.direct;
  const proxy = cache.proxy;
  if (direct) {
    directExitIp.textContent = direct.ip;
    directExitLocation.textContent = formatNetworkLocation(direct);
    directExitNetwork.textContent = formatNetworkProvider(direct);
    directExitTime.textContent = `请求 ${direct.requestMs} ms`;
  } else {
    directExitIp.textContent = "获取失败";
    directExitLocation.textContent = cache.directError || "—";
    directExitNetwork.textContent = "—";
    directExitTime.textContent = "";
  }
  if (proxy) {
    proxyExitIp.textContent = proxy.ip;
    proxyExitLocation.textContent = formatNetworkLocation(proxy);
    proxyExitNetwork.textContent = formatNetworkProvider(proxy);
    proxyExitTime.textContent = `请求 ${proxy.requestMs} ms`;
  } else {
    proxyExitIp.textContent = "获取失败";
    proxyExitLocation.textContent = cache.proxyError || "—";
    proxyExitNetwork.textContent = "—";
    proxyExitTime.textContent = "";
  }

  const healthy = Boolean(direct && proxy && direct.ip !== proxy.ip);
  networkLastChecked.textContent = formatLastChecked(cache.checkedAt);
  networkRouteSummary.dataset.state = healthy ? "healthy" : "unhealthy";
  networkRouteSummary.textContent = healthy
    ? "代理出口与本地直连不同，代理生效。"
    : direct && proxy && direct.ip === proxy.ip
      ? "代理出口与本地直连相同，判定为异常。"
      : "未能同时取得两个出口 IP，判定为异常。";
  setHealth(healthy);
}

async function restoreNetworkInfoForState(state: ProxyProviderState): Promise<void> {
  const stored = await chrome.storage.local.get(NETWORK_INFO_CACHE_KEY);
  const cache = stored[NETWORK_INFO_CACHE_KEY] as unknown;
  if (cacheMatchesActive(cache, state)) renderNetworkInfo(cache);
  else resetNetworkInfo("尚无当前代理节点的检测结果；节点变化后会自动检测，也可以手动刷新。");
}

async function saveNetworkCache(cache: NetworkInfoCache): Promise<void> {
  await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });
}

async function refreshNetworkInfo(showProgressToast = true): Promise<void> {
  if (!providerState || refreshNetworkInfoButton.dataset.running === "true") return;
  const stateAtStart = providerState;
  refreshNetworkInfoButton.dataset.running = "true";
  refreshNetworkInfoButton.disabled = true;
  refreshNetworkInfoButton.textContent = "检测中";
  setHealth(false, true);
  if (showProgressToast) showToast("正在检测两个公网出口…", "info");

  try {
    const response = await sendMessage<{
      direct?: NetworkRouteInfo;
      proxy?: NetworkRouteInfo;
      directError?: string;
      proxyError?: string;
      sameExitIp: boolean;
    }>({ type: "GET_NETWORK_INFO" });
    if (!response.ok || !response.data) throw new Error(response.error ?? "网络信息检测失败");

    if (!providerState || providerState.activeProxy.host !== stateAtStart.activeProxy.host ||
        providerState.activeProxy.port !== stateAtStart.activeProxy.port) return;

    const cache: NetworkInfoCache = {
      host: stateAtStart.activeProxy.host,
      port: stateAtStart.activeProxy.port,
      checkedAt: new Date().toISOString(),
      direct: response.data.direct,
      proxy: response.data.proxy,
      directError: response.data.directError,
      proxyError: response.data.proxyError,
      sameExitIp: response.data.sameExitIp,
    };
    await saveNetworkCache(cache);
    renderNetworkInfo(cache);
    if (showProgressToast) showToast(response.message ?? "网络信息已更新", cache.direct && cache.proxy && cache.direct.ip !== cache.proxy.ip ? "success" : "warning");
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络信息检测失败";
    const cache: NetworkInfoCache = {
      host: stateAtStart.activeProxy.host,
      port: stateAtStart.activeProxy.port,
      checkedAt: new Date().toISOString(),
      directError: message,
      proxyError: message,
      sameExitIp: false,
    };
    await saveNetworkCache(cache);
    if (providerState && providerState.activeProxy.host === stateAtStart.activeProxy.host &&
        providerState.activeProxy.port === stateAtStart.activeProxy.port) renderNetworkInfo(cache);
    if (showProgressToast) showToast(message, "error");
  } finally {
    refreshNetworkInfoButton.dataset.running = "false";
    refreshNetworkInfoButton.disabled = false;
    refreshNetworkInfoButton.textContent = "刷新";
  }
}

function renderProviderState(state: ProxyProviderState): void {
  providerState = state;
  subscriptionRadio.checked = state.sourceMode === "subscription";
  manualRadio.checked = state.sourceMode === "manual";
  subscriptionSettings.hidden = state.sourceMode !== "subscription";
  manualSettings.hidden = state.sourceMode !== "manual";
  subscriptionUrlInput.value = state.subscriptionUrl;
  refreshProxySubscriptionButton.disabled = !state.subscriptionUrl;

  if (state.manualOverride) {
    manualHostInput.value = state.manualOverride.host;
    manualPortInput.value = String(state.manualOverride.port);
  }

  const subscriptionFailure = state.subscriptionError || state.subscription?.error;
  if (subscriptionFailure) {
    subscriptionStateBadge.dataset.state = "error";
    subscriptionStateBadge.textContent = "更新失败";
    subscriptionStateBadge.title = subscriptionFailure;
  } else if (state.subscription) {
    subscriptionStateBadge.dataset.state = "ready";
    subscriptionStateBadge.textContent = formatSubscriptionBadgeTime(state.subscription.fetchedAt);
    subscriptionStateBadge.title = `上次更新 ${formatDateTime(state.subscription.fetchedAt)}`;
  } else {
    subscriptionStateBadge.dataset.state = "idle";
    subscriptionStateBadge.textContent = state.subscriptionUrl ? "待更新" : "未配置";
    subscriptionStateBadge.removeAttribute("title");
  }

  if (state.subscription) {
    const first = state.subscription.document.proxies[0];
    subscriptionMeta.textContent = subscriptionFailure
      ? `${first.name} · ${endpoint(first)} · 上次成功 ${formatDateTime(state.subscription.fetchedAt)}`
      : `${first.name} · ${endpoint(first)}`;
  } else if (state.subscriptionError) {
    subscriptionMeta.textContent = state.subscriptionError;
  } else if (!state.subscriptionUrl) {
    subscriptionMeta.textContent = "未配置订阅时使用内置 127.0.0.1:7890 兜底。";
  } else {
    subscriptionMeta.textContent = "尚未加载订阅。";
  }

  const sourceLabels: Record<EffectiveProxySource, string> = {
    subscription: "代理订阅",
    manual: "手动覆盖",
    fallback: "内置兜底",
  };
  activeProxyTitle.textContent = `${state.activeProxy.name} · ${sourceLabels[state.effectiveSource]}`;
  activeProxyEndpoint.textContent = endpoint(state.activeProxy);
}

async function applyProviderState(state: ProxyProviderState, autoDetectOnEndpointChange: boolean): Promise<void> {
  const changed = endpointChanged(providerState, state);
  renderProviderState(state);
  await restoreNetworkInfoForState(state);
  if (changed && autoDetectOnEndpointChange) void refreshNetworkInfo(false);
}

async function requestUrlPermission(url: string): Promise<void> {
  if (!url.trim()) return;
  const parsed = new URL(url);
  if (parsed.hostname === "raw.githubusercontent.com") return;
  const origins = [`${parsed.origin}/*`];
  if (await chrome.permissions.contains({ origins })) return;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error("未授予该订阅地址的访问权限");
}

const FALLBACK_DESCRIPTIONS: Record<FallbackMode, string> = {
  direct: "未命中任何规则的网站由 Chrome 直接连接。",
  proxy: "未命中任何规则的网站全部使用当前代理。",
  system: "交还 Chrome / 操作系统代理；Auto Proxy 的规则分流会暂停。",
};

function renderFallbackMode(mode: FallbackMode): void {
  fallbackModeElement.value = mode;
  fallbackDescriptionElement.textContent = FALLBACK_DESCRIPTIONS[mode];
}

async function saveFallbackMode(): Promise<void> {
  const fallbackMode = fallbackModeElement.value as FallbackMode;
  renderFallbackMode(fallbackMode);
  const response = await sendMessage({ type: "UPDATE_FALLBACK_MODE", fallbackMode });
  if (!response.ok) throw new Error(response.error ?? "未命中策略保存失败");
  showToast(response.message ?? "未命中策略已保存", fallbackMode === "system" ? "warning" : "success");
}

function activateTab(tab: "proxy" | "rules"): void {
  currentSettingsTab = tab;
  aboutPanel.hidden = true;
  aboutButton.classList.remove("active");
  aboutButton.setAttribute("aria-pressed", "false");
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== tab;
}

function openAbout(): void {
  for (const button of tabButtons) {
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
  }
  for (const panel of tabPanels) panel.hidden = true;
  aboutPanel.hidden = false;
  aboutButton.classList.add("active");
  aboutButton.setAttribute("aria-pressed", "true");
}

function formatRuleUpdate(pack: RulePackSetting): string {
  const candidates = [pack.source.updatedAt, pack.source.modifiedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (candidates.length === 0) return pack.managed ? "内置规则可用" : "尚未更新";
  const latest = new Date(Math.max(...candidates.map((date) => date.getTime())));
  return `更新 ${latest.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function renderManagedRules(settings: readonly RulePackSetting[]): void {
  const managed = settings.filter((pack) => pack.managed);
  const totalRules = managed.reduce((sum, pack) => sum + (pack.validation?.effective ?? 0), 0);
  const customizedCount = managed.filter((pack) => pack.customized).length;
  managedRuleCount.textContent = customizedCount > 0
    ? `${managed.length} 组 · ${totalRules} 条 · ${customizedCount} 项已修改`
    : `${managed.length} 组 · ${totalRules} 条`;
  managedRuleCount.dataset.state = customizedCount > 0 ? "cached" : "ready";

  const fragment = document.createDocumentFragment();
  for (const pack of managed) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "managed-rule-row";
    row.addEventListener("click", () => {
      managedRulesDialog.close();
      openRuleEditor(pack);
    });

    const copy = document.createElement("span");
    copy.className = "managed-rule-copy";
    const name = document.createElement("strong");
    name.textContent = pack.name;
    const meta = document.createElement("small");
    meta.textContent = `${pack.validation?.effective ?? 0} 条有效 · ${formatRuleUpdate(pack)}`;
    copy.append(name, meta);

    const state = document.createElement("span");
    state.className = "managed-rule-state";
    state.dataset.customized = String(Boolean(pack.customized));
    state.textContent = pack.customized ? "已修改" : "默认";
    row.append(copy, state);
    fragment.append(row);
  }
  managedRuleList.replaceChildren(fragment);
}

function getEnabledCustomIds(): string[] {
  return Array.from(customRuleList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

async function saveCustomRuleSelection(): Promise<void> {
  const response = await sendMessage({ type: "UPDATE_RULE_PACKS", enabledPackIds: getEnabledCustomIds() });
  if (!response.ok) throw new Error(response.error ?? "自定义规则保存失败");
  showToast(response.message ?? "自定义规则已保存", "success");
}

function renderCustomRules(settings: readonly RulePackSetting[]): void {
  const custom = settings.filter((pack) => !pack.managed);
  customRuleEmpty.hidden = custom.length > 0;
  const fragment = document.createDocumentFragment();
  for (const pack of custom) {
    const card = document.createElement("article");
    card.className = "rule-pack-card";
    const row = document.createElement("div");
    row.className = "rule-pack-item";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "rule-pack-open";
    open.addEventListener("click", () => openRuleEditor(pack));
    const titleLine = document.createElement("span");
    titleLine.className = "rule-pack-title-line";
    const name = document.createElement("strong");
    name.textContent = pack.name;
    const count = document.createElement("span");
    count.className = "rule-count-badge";
    count.textContent = String(pack.validation?.effective ?? 0);
    titleLine.append(name, count);
    const meta = document.createElement("span");
    meta.className = "rule-pack-meta";
    meta.textContent = `${formatRuleUpdate(pack)} · ${pack.defaultAction === "PROXY" ? "代理" : "直连"}`;
    open.append(titleLine, meta);

    const toggle = document.createElement("label");
    toggle.className = "rule-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = pack.id;
    checkbox.checked = pack.enabled;
    checkbox.setAttribute("aria-label", `启用 ${pack.name}`);
    checkbox.addEventListener("change", () => {
      void saveCustomRuleSelection().catch((error) => {
        checkbox.checked = !checkbox.checked;
        showToast(error instanceof Error ? error.message : "规则保存失败", "error");
      });
    });
    const track = document.createElement("span");
    track.setAttribute("aria-hidden", "true");
    toggle.append(checkbox, track);
    row.append(open, toggle);
    card.append(row);
    fragment.append(card);
  }
  customRuleList.replaceChildren(fragment);
}

function renderRulePacks(settings: RulePackSetting[]): void {
  rulePackSettings = settings;
  renderManagedRules(settings);
  renderCustomRules(settings);
}

function ruleEditorMetaText(pack: RulePackSetting): string {
  const status = pack.source.status === "cached" ? "使用缓存" : pack.source.status === "error" ? "更新异常" : "";
  return [formatRuleUpdate(pack), pack.validation ? `${pack.validation.effective} 条有效` : undefined, status, pack.source.error]
    .filter(Boolean).join(" · ");
}

function openRuleEditor(pack?: RulePackSetting): void {
  editingRulePack = pack ?? null;
  const managed = Boolean(pack?.managed);
  ruleEditorKicker.textContent = managed ? "DEFAULT RULE" : "CUSTOM RULE";
  ruleEditorTitle.textContent = pack
    ? managed ? `编辑默认规则 · ${pack.name}` : `编辑 ${pack.name}`
    : "添加自定义规则";
  ruleEditorNameInput.value = pack?.name ?? "";
  ruleEditorUrlInput.value = pack?.source.url || pack?.defaultUrl || "";
  ruleEditorActionSelect.value = pack?.defaultAction ?? "PROXY";
  ruleEditorSourceStrategySelect.value = pack?.sourceStrategy ?? "merge";
  ruleEditorContent.value = pack?.source.customContent ?? "";
  ruleEditorHint.textContent = managed
    ? "这是产品内置规则。修改后会覆盖默认配置；如需回到产品预设，可使用“恢复默认”。"
    : "自定义规则会在默认规则之前编译，因此可以明确覆盖产品默认行为。";

  ruleEditorDeleteButton.hidden = !pack || (managed && !pack.customized);
  ruleEditorDeleteButton.textContent = managed ? "恢复默认" : "删除规则";
  ruleEditorDeleteButton.classList.toggle("reset-button", managed);
  ruleEditorDeleteButton.classList.toggle("danger-button", !managed);
  ruleEditorRefreshButton.hidden = !pack || !(pack.source.url || pack.defaultUrl);
  ruleEditorMeta.textContent = pack ? ruleEditorMetaText(pack) : "自定义规则优先于默认规则。";
  ruleEditorDialog.showModal();
}

function closeRuleEditor(): void {
  editingRulePack = null;
  ruleEditorDialog.close();
}

async function reloadRuleSettings(): Promise<void> {
  const response = await sendMessage<RulePackSetting[]>({ type: "GET_RULE_PACK_SETTINGS" });
  if (!response.ok || !response.data) throw new Error(response.error ?? "规则读取失败");
  renderRulePacks(response.data);
}

async function saveRuleEditor(): Promise<void> {
  const name = ruleEditorNameInput.value.trim();
  const url = ruleEditorUrlInput.value.trim();
  if (url) await requestUrlPermission(url);
  const response = await sendMessage<{ packId: string }>({
    type: "SAVE_RULE_PACK",
    packId: editingRulePack?.id,
    name,
    url,
    action: ruleEditorActionSelect.value as "DIRECT" | "PROXY",
    customContent: ruleEditorContent.value,
    sourceStrategy: ruleEditorSourceStrategySelect.value as SourceStrategy,
  });
  if (!response.ok) throw new Error(response.error ?? "规则保存失败");
  closeRuleEditor();
  await reloadRuleSettings();
  showToast(response.message ?? "规则已保存", "success");
}

async function refreshEditingRule(): Promise<void> {
  if (!editingRulePack) return;
  const url = ruleEditorUrlInput.value.trim() || editingRulePack.defaultUrl;
  if (url) await requestUrlPermission(url);
  ruleEditorRefreshButton.disabled = true;
  try {
    const response = await sendMessage({ type: "REFRESH_RULE_PACK", packId: editingRulePack.id });
    if (!response.ok) throw new Error(response.error ?? "规则下载失败");
    await reloadRuleSettings();
    editingRulePack = rulePackSettings.find((pack) => pack.id === editingRulePack?.id) ?? editingRulePack;
    ruleEditorMeta.textContent = ruleEditorMetaText(editingRulePack);
    showToast(response.message ?? "规则已更新", "success");
  } finally {
    ruleEditorRefreshButton.disabled = false;
  }
}

async function deleteEditingRule(): Promise<void> {
  if (!editingRulePack) return;
  ruleEditorDeleteButton.disabled = true;
  try {
    if (editingRulePack.managed) {
      const response = await sendMessage({ type: "RESET_MANAGED_RULE_PACK", packId: editingRulePack.id });
      if (!response.ok) throw new Error(response.error ?? "恢复默认失败");
      closeRuleEditor();
      await reloadRuleSettings();
      showToast(response.message ?? "默认规则已恢复", "success");
      return;
    }

    const response = await sendMessage({ type: "DELETE_RULE_PACK", packId: editingRulePack.id });
    if (!response.ok) throw new Error(response.error ?? "删除失败");
    closeRuleEditor();
    await reloadRuleSettings();
    showToast(response.message ?? "规则已删除", "success");
  } finally {
    ruleEditorDeleteButton.disabled = false;
  }
}

async function loadDiagnostics(): Promise<void> {
  const response = await sendMessage<DiagnosticEvent[]>({ type: "GET_DIAGNOSTIC_EVENTS" });
  if (!response.ok) throw new Error(response.error ?? "诊断记录读取失败");
  const events = response.data ?? [];
  if (events.length === 0) {
    diagnosticList.textContent = "暂无诊断记录";
    return;
  }
  const labels = { proxy: "代理", subscription: "订阅", background: "后台" };
  const fragment = document.createDocumentFragment();
  for (const item of events) {
    const row = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = `[${labels[item.type]}] ${item.message}`;
    const time = document.createElement("time");
    time.dateTime = item.occurredAt;
    time.textContent = new Date(item.occurredAt).toLocaleString("zh-CN", { hour12: false });
    const details = document.createElement("small");
    details.textContent = item.details || "无更多信息";
    row.append(title, time, details);
    fragment.append(row);
  }
  diagnosticList.replaceChildren(fragment);
}

async function loadStoredData(): Promise<void> {
  const [stored, providerResponse, rulesResponse] = await Promise.all([
    chrome.storage.local.get([
      INSTALL_TIME_KEY, ACTIVE_TAB_KEY, AUTO_REFRESH_ENABLED_KEY,
      AUTO_REFRESH_INTERVAL_KEY, NETWORK_INFO_CACHE_KEY, FALLBACK_MODE_KEY,
    ]),
    sendMessage<ProxyProviderState>({ type: "GET_PROXY_PROVIDER_STATE" }),
    sendMessage<RulePackSetting[]>({ type: "GET_RULE_PACK_SETTINGS" }),
  ]);
  if (!providerResponse.ok || !providerResponse.data) throw new Error(providerResponse.error ?? "代理配置读取失败");
  if (!rulesResponse.ok || !rulesResponse.data) throw new Error(rulesResponse.error ?? "规则读取失败");

  activateTab(stored[ACTIVE_TAB_KEY] === "rules" ? "rules" : "proxy");
  renderProviderState(providerResponse.data);
  const cache = stored[NETWORK_INFO_CACHE_KEY] as unknown;
  if (cacheMatchesActive(cache, providerResponse.data)) renderNetworkInfo(cache);
  else resetNetworkInfo("尚无当前代理节点的检测结果；节点变化后会自动检测，也可以手动刷新。");
  renderRulePacks(rulesResponse.data);
  const storedFallback = stored[FALLBACK_MODE_KEY] as unknown;
  renderFallbackMode(storedFallback === "proxy" || storedFallback === "system" ? storedFallback : "direct");

  const autoEnabled = stored[AUTO_REFRESH_ENABLED_KEY] !== false;
  const interval = Number(stored[AUTO_REFRESH_INTERVAL_KEY]);
  autoRefreshEnabled.checked = autoEnabled;
  autoRefreshInterval.value = String([6, 12, 24, 168].includes(interval) ? interval : 24);
  autoRefreshInterval.disabled = !autoEnabled;
  installedAtElement.textContent = stored[INSTALL_TIME_KEY]
    ? new Date(stored[INSTALL_TIME_KEY] as string).toLocaleString("zh-CN", { hour12: false })
    : "暂无记录";
}

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const url = subscriptionUrlInput.value.trim();
    if (url) await requestUrlPermission(url);
    const before = providerState;
    const response = await sendMessage<{
      state: ProxyProviderState;
      endpointChanged: boolean;
      usedCached: boolean;
      updateFailed?: string;
    }>({ type: "SAVE_PROXY_SUBSCRIPTION", url });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理订阅保存失败");
    await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
    showToast(response.data.updateFailed ?? response.message ?? "代理订阅已保存",
      response.data.updateFailed || response.data.usedCached ? "warning" : "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "代理订阅保存失败", "error"));
});

refreshProxySubscriptionButton.addEventListener("click", () => {
  void (async () => {
    if (!providerState?.subscriptionUrl) throw new Error("尚未配置代理订阅地址");
    await requestUrlPermission(providerState.subscriptionUrl);
    refreshProxySubscriptionButton.disabled = true;
    const before = providerState;
    const response = await sendMessage<{
      state: ProxyProviderState;
      endpointChanged: boolean;
      usedCached: boolean;
      updateFailed?: string;
    }>({ type: "REFRESH_PROXY_SUBSCRIPTION" });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理订阅更新失败");
    await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
    showToast(response.data.updateFailed ?? response.message ?? "代理订阅已更新",
      response.data.updateFailed || response.data.usedCached ? "warning" : "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "代理订阅更新失败", "error"))
    .finally(() => { refreshProxySubscriptionButton.disabled = !providerState?.subscriptionUrl; });
});

subscriptionRadio.addEventListener("change", () => {
  if (!subscriptionRadio.checked) return;
  const before = providerState;
  void sendMessage<{ state: ProxyProviderState }>({ type: "SET_PROXY_SOURCE_MODE", mode: "subscription" })
    .then(async (response) => {
      if (!response.ok || !response.data) throw new Error(response.error ?? "代理来源切换失败");
      await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
      showToast(response.message ?? "已切换到代理订阅", "success");
    })
    .catch((error) => {
      if (providerState) renderProviderState(providerState);
      showToast(error instanceof Error ? error.message : "代理来源切换失败", "error");
    });
});

manualRadio.addEventListener("change", () => {
  if (!manualRadio.checked) return;
  if (!providerState?.manualOverride) {
    // 第一次使用手动覆盖时先展开表单；真正保存时后台会同时切换到 manual。
    subscriptionSettings.hidden = true;
    manualSettings.hidden = false;
    showToast("填写代理地址并保存后即可启用手动覆盖", "info");
    manualHostInput.focus();
    return;
  }

  const before = providerState;
  void sendMessage<{ state: ProxyProviderState }>({ type: "SET_PROXY_SOURCE_MODE", mode: "manual" })
    .then(async (response) => {
      if (!response.ok || !response.data) throw new Error(response.error ?? "代理来源切换失败");
      await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
      showToast(response.message ?? "已使用手动代理覆盖", "success");
    })
    .catch((error) => {
      if (providerState) renderProviderState(providerState);
      showToast(error instanceof Error ? error.message : "代理来源切换失败", "error");
    });
});

manualProxyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const host = manualHostInput.value.trim();
    const port = Number(manualPortInput.value);
    if (!validateHost(host)) throw new Error("代理地址只填写主机名或 IP");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1 到 65535 的整数");
    const before = providerState;
    const response = await sendMessage<{ state: ProxyProviderState }>({ type: "SAVE_MANUAL_PROXY", host, port });
    if (!response.ok || !response.data) throw new Error(response.error ?? "手动代理保存失败");
    await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
    showToast(response.message ?? "手动代理已保存", "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "手动代理保存失败", "error"));
});

refreshNetworkInfoButton.addEventListener("click", () => { void refreshNetworkInfo(); });

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;
    if (target !== "proxy" && target !== "rules") return;
    activateTab(target);
    void chrome.storage.local.set({ [ACTIVE_TAB_KEY]: target });
  });
}

aboutButton.addEventListener("click", () => {
  openAbout();
  void loadDiagnostics().catch((error) => showToast(error instanceof Error ? error.message : "诊断读取失败", "error"));
});

manageManagedRulesButton.addEventListener("click", () => managedRulesDialog.showModal());
managedRulesCloseButton.addEventListener("click", () => managedRulesDialog.close());
managedRulesDialog.addEventListener("click", (event) => {
  if (event.target === managedRulesDialog) managedRulesDialog.close();
});

addRulePackButton.addEventListener("click", () => openRuleEditor());
ruleEditorCloseButton.addEventListener("click", closeRuleEditor);
ruleEditorCancelButton.addEventListener("click", closeRuleEditor);
ruleEditorDialog.addEventListener("click", (event) => { if (event.target === ruleEditorDialog) closeRuleEditor(); });
ruleEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveRuleEditor().catch((error) => showToast(error instanceof Error ? error.message : "规则保存失败", "error"));
});
ruleEditorRefreshButton.addEventListener("click", () => {
  void refreshEditingRule().catch((error) => showToast(error instanceof Error ? error.message : "规则更新失败", "error"));
});
ruleEditorDeleteButton.addEventListener("click", () => {
  void deleteEditingRule().catch((error) => showToast(error instanceof Error ? error.message : "规则删除失败", "error"));
});

refreshEnabledRulesButton.addEventListener("click", () => {
  refreshEnabledRulesButton.disabled = true;
  void sendMessage({ type: "REFRESH_ENABLED_RULE_PACKS" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "规则更新失败");
      await reloadRuleSettings();
      showToast(response.message ?? "规则更新完成", "success");
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "规则更新失败", "error"))
    .finally(() => { refreshEnabledRulesButton.disabled = false; });
});

ruleMatchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage<{
    hostname: string;
    action: "DIRECT" | "PROXY" | "SYSTEM";
    matched: boolean;
    rule?: { type: string; value: string };
  }>({ type: "TEST_RULE_MATCH", input: ruleMatchInput.value })
    .then((response) => {
      if (!response.ok || !response.data) throw new Error(response.error ?? "规则匹配失败");
      const action = response.data.action === "PROXY" ? "代理" : response.data.action === "SYSTEM" ? "系统代理" : "直连";
      showToast(response.data.matched && response.data.rule
        ? `${response.data.hostname} → ${action} · 命中 ${response.data.rule.type},${response.data.rule.value}`
        : `${response.data.hostname} → ${action} · 未命中规则`, "info");
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "规则匹配失败", "error"));
});

async function saveAutoRefreshSettings(): Promise<void> {
  const enabled = autoRefreshEnabled.checked;
  const intervalHours = Number(autoRefreshInterval.value);
  autoRefreshInterval.disabled = !enabled;
  const response = await sendMessage({ type: "UPDATE_RULE_AUTO_REFRESH", enabled, intervalHours });
  if (!response.ok) throw new Error(response.error ?? "自动更新设置保存失败");
  showToast(response.message ?? "自动更新设置已保存", "success");
}
autoRefreshEnabled.addEventListener("change", () => { void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error")); });
autoRefreshInterval.addEventListener("change", () => { void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error")); });

fallbackModeElement.addEventListener("change", () => {
  void saveFallbackMode().catch((error: unknown) => {
    showToast(error instanceof Error ? error.message : "未命中策略保存失败", "error");
  });
});

clearDiagnosticsButton.addEventListener("click", () => {
  clearDiagnosticsButton.disabled = true;
  void sendMessage({ type: "CLEAR_DIAGNOSTIC_EVENTS" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "清除失败");
      await loadDiagnostics();
      showToast(response.message ?? "诊断记录已清除", "success");
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "清除失败", "error"))
    .finally(() => { clearDiagnosticsButton.disabled = false; });
});

void loadStoredData().catch((error) => {
  console.error(error);
  showToast(error instanceof Error ? error.message : "读取配置失败", "error");
});
