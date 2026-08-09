import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import { refreshStatusThresholds, type RefreshUnit } from "../shared/refresh-interval.ts";
import { requiredElement } from "./dom.ts";
import {
  refreshNetworkInfo,
  restoreNetworkInfoForState,
} from "./network-info.ts";
import { getProviderState, setProviderState } from "./provider-state.ts";
import {
  renderRefreshInterval,
  selectedRefreshInterval,
  setCustomIntervalInputLimit,
} from "./refresh-controls.ts";
import {
  clearRelativeTimeStatus,
  formatDateTime,
  setRelativeTimeStatus,
} from "./relative-time.ts";
import { requestUrlPermission, sendMessage } from "./runtime-client.ts";
import { setStatusBadge } from "./status-badge.ts";
import { showToast } from "./toast.ts";

type ProxySourceMode = ProxyProviderState["sourceMode"];

const proxySourceOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-proxy-source-option]"));
const proxySourceCheckmarks = Array.from(document.querySelectorAll<HTMLElement>("[data-proxy-source-check]"));
const subscriptionSettings = requiredElement<HTMLElement>("#subscription-settings");
const manualSettings = requiredElement<HTMLElement>("#manual-settings");
const subscriptionForm = requiredElement<HTMLFormElement>("#subscription-form");
const subscriptionUrlInput = requiredElement<HTMLInputElement>("#subscription-url");
const subscriptionStateBadge = requiredElement<HTMLElement>("#subscription-state-badge");
const refreshProxySubscriptionButton = requiredElement<HTMLButtonElement>("#refresh-proxy-subscription");
const manualProxyForm = requiredElement<HTMLFormElement>("#manual-proxy-form");
const manualHostInput = requiredElement<HTMLInputElement>("#manual-proxy-host");
const manualPortInput = requiredElement<HTMLInputElement>("#manual-proxy-port");
const proxyRefreshInterval = requiredElement<HTMLSelectElement>("#proxy-refresh-interval");
const proxyRefreshCustomGroup = requiredElement<HTMLElement>("#proxy-refresh-custom-group");
const proxyRefreshCustomValue = requiredElement<HTMLInputElement>("#proxy-refresh-custom-value");
const proxyRefreshCustomUnit = requiredElement<HTMLSelectElement>("#proxy-refresh-custom-unit");

let pendingProxySourceMode: ProxySourceMode | undefined;
let proxyAutoRefreshEnabled = true;
let proxyRefreshIntervalMinutes = 360;

const activeSourceClass = "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/10 dark:border-[#0a84ff] dark:bg-[#0a84ff]/10";
const idleSourceClass = "border-stone-200 hover:border-stone-300 hover:bg-stone-50 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5";

function renderSourceSelection(visibleMode: ProxySourceMode, activeMode: ProxySourceMode): void {
  subscriptionSettings.hidden = visibleMode !== "subscription";
  manualSettings.hidden = visibleMode !== "manual";
  for (const button of proxySourceOptionButtons) {
    const mode = button.dataset.proxySourceOption === "manual" ? "manual" : "subscription";
    const selected = mode === visibleMode;
    button.setAttribute("aria-checked", String(selected));
    button.className = `flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${selected ? activeSourceClass : idleSourceClass}`;
  }
  for (const checkmark of proxySourceCheckmarks) {
    const mode = checkmark.dataset.proxySourceCheck === "manual" ? "manual" : "subscription";
    checkmark.hidden = mode !== activeMode;
  }
}

function endpointChanged(before: ProxyProviderState | undefined, after: ProxyProviderState): boolean {
  return !before || before.activeProxy.host !== after.activeProxy.host ||
    before.activeProxy.port !== after.activeProxy.port;
}

function validateHost(host: string): boolean {
  return Boolean(host) && !host.includes("://") && !host.includes("/");
}

export function renderProviderState(state: ProxyProviderState): void {
  setProviderState(state);
  renderSourceSelection(pendingProxySourceMode ?? state.sourceMode, state.sourceMode);
  subscriptionUrlInput.value = state.subscriptionUrl;
  refreshProxySubscriptionButton.disabled = !state.subscriptionUrl;
  if (state.manualOverride) {
    manualHostInput.value = state.manualOverride.host;
    manualPortInput.value = String(state.manualOverride.port);
  }

  const subscriptionFailure = state.subscriptionError || state.subscription?.error;
  if (subscriptionFailure) {
    clearRelativeTimeStatus(subscriptionStateBadge);
    subscriptionStateBadge.dataset.state = "error";
    setStatusBadge(subscriptionStateBadge, "更新失败", "error", subscriptionFailure);
  } else if (state.subscription) {
    subscriptionStateBadge.dataset.state = "ready";
    const thresholds = refreshStatusThresholds(
      proxyAutoRefreshEnabled,
      proxyRefreshIntervalMinutes,
      360,
      1_440,
    );
    setRelativeTimeStatus(subscriptionStateBadge, state.subscription.fetchedAt, {
      baseClass: "status-badge",
      ...thresholds,
      hideWhenFresh: proxyAutoRefreshEnabled,
    });
    subscriptionStateBadge.title = `上次更新 ${formatDateTime(state.subscription.fetchedAt)}`;
  } else {
    clearRelativeTimeStatus(subscriptionStateBadge);
    subscriptionStateBadge.dataset.state = "idle";
    setStatusBadge(subscriptionStateBadge, state.subscriptionUrl ? "待更新" : "未配置", "idle");
  }
}

function focusProxyEditor(mode: ProxySourceMode): void {
  const activeMode = getProviderState()?.sourceMode ?? mode;
  renderSourceSelection(mode, activeMode);
  if (mode === "subscription") subscriptionUrlInput.focus();
  else manualHostInput.focus();
}

async function applyProviderState(state: ProxyProviderState, autoDetect: boolean): Promise<void> {
  renderProviderState(state);
  await restoreNetworkInfoForState(state);
  if (autoDetect) void refreshNetworkInfo(false);
}

export function initializeProxySettings(state: ProxyProviderState, intervalMinutes: number): void {
  proxyAutoRefreshEnabled = intervalMinutes !== 0;
  proxyRefreshIntervalMinutes = intervalMinutes;
  renderRefreshInterval(
    proxyRefreshInterval,
    proxyRefreshCustomGroup,
    proxyRefreshCustomValue,
    proxyRefreshCustomUnit,
    intervalMinutes,
  );
  renderProviderState(state);
}

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const url = subscriptionUrlInput.value.trim();
    if (url) await requestUrlPermission(url);
    const before = getProviderState();
    const response = await sendMessage<{
      state: ProxyProviderState;
      endpointChanged: boolean;
      usedCached: boolean;
      updateFailed?: string;
    }>({ type: "SAVE_PROXY_SUBSCRIPTION", url });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理订阅保存失败");
    const firstSuccessfulLoad = response.data.state.subscription?.url === url &&
      (!before?.subscription || before.subscription.url !== url);
    let nextState = response.data.state;
    if (pendingProxySourceMode === "subscription" && nextState.subscription) {
      const modeResponse = await sendMessage<{ state: ProxyProviderState }>({
        type: "SET_PROXY_SOURCE_MODE",
        mode: "subscription",
      });
      if (!modeResponse.ok || !modeResponse.data) {
        throw new Error(modeResponse.error ?? "代理订阅已保存，但切换来源失败");
      }
      nextState = modeResponse.data.state;
    }
    await applyProviderState(nextState, firstSuccessfulLoad || endpointChanged(before, nextState));
    pendingProxySourceMode = undefined;
    showToast(response.data.updateFailed ?? response.message ?? "代理订阅已保存",
      response.data.updateFailed || response.data.usedCached ? "warning" : "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "代理订阅保存失败", "error"));
});

refreshProxySubscriptionButton.addEventListener("click", () => {
  void (async () => {
    const providerState = getProviderState();
    if (!providerState?.subscriptionUrl) throw new Error("尚未配置代理订阅地址");
    await requestUrlPermission(providerState.subscriptionUrl);
    refreshProxySubscriptionButton.disabled = true;
    const response = await sendMessage<{
      state: ProxyProviderState;
      endpointChanged: boolean;
      usedCached: boolean;
      updateFailed?: string;
    }>({ type: "REFRESH_PROXY_SUBSCRIPTION" });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理订阅更新失败");
    await applyProviderState(response.data.state, endpointChanged(providerState, response.data.state));
    showToast(response.data.updateFailed ?? response.message ?? "代理订阅已更新",
      response.data.updateFailed || response.data.usedCached ? "warning" : "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "代理订阅更新失败", "error"))
    .finally(() => { refreshProxySubscriptionButton.disabled = !getProviderState()?.subscriptionUrl; });
});

async function selectProxySource(mode: ProxySourceMode): Promise<void> {
  const providerState = getProviderState();
  if (!providerState) return;
  if (mode === providerState.sourceMode) {
    pendingProxySourceMode = undefined;
    focusProxyEditor(mode);
    return;
  }

  if (mode === "manual" && !providerState.manualOverride) {
    pendingProxySourceMode = "manual";
    focusProxyEditor("manual");
    showToast("请先保存手动代理，保存后会自动切换", "info");
    return;
  }
  if (mode === "subscription" && !providerState.subscription) {
    pendingProxySourceMode = "subscription";
    focusProxyEditor("subscription");
    showToast("请先保存并更新代理订阅，成功后会自动切换", "info");
    return;
  }

  for (const button of proxySourceOptionButtons) button.disabled = true;
  try {
    const response = await sendMessage<{ state: ProxyProviderState }>({
      type: "SET_PROXY_SOURCE_MODE",
      mode,
    });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理来源切换失败");
    await applyProviderState(response.data.state, endpointChanged(providerState, response.data.state));
    showToast(response.message ?? (mode === "manual" ? "已使用手动代理" : "已使用代理订阅"), "success");
  } finally {
    for (const button of proxySourceOptionButtons) button.disabled = false;
  }
}

for (const button of proxySourceOptionButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.proxySourceOption === "manual" ? "manual" : "subscription";
    void selectProxySource(mode).catch((error) => {
      const providerState = getProviderState();
      if (providerState) renderProviderState(providerState);
      showToast(error instanceof Error ? error.message : "代理来源切换失败", "error");
    });
  });
}

manualProxyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const host = manualHostInput.value.trim();
    const port = Number(manualPortInput.value);
    if (!validateHost(host)) throw new Error("代理地址只填写主机名或 IP");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1 到 65535 的整数");
    const before = getProviderState();
    const response = await sendMessage<{ state: ProxyProviderState }>({ type: "SAVE_MANUAL_PROXY", host, port });
    if (!response.ok || !response.data) throw new Error(response.error ?? "手动代理保存失败");
    await applyProviderState(response.data.state, endpointChanged(before, response.data.state));
    pendingProxySourceMode = undefined;
    showToast(response.message ?? "手动代理已保存", "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "手动代理保存失败", "error"));
});

async function saveProxyRefreshInterval(): Promise<void> {
  const intervalMinutes = selectedRefreshInterval(
    proxyRefreshInterval,
    proxyRefreshCustomValue,
    proxyRefreshCustomUnit,
  );
  const response = await sendMessage({ type: "UPDATE_PROXY_SUBSCRIPTION_REFRESH", intervalMinutes });
  if (!response.ok) throw new Error(response.error ?? "更新时间保存失败");
  proxyAutoRefreshEnabled = intervalMinutes !== 0;
  proxyRefreshIntervalMinutes = intervalMinutes;
  const state = getProviderState();
  if (state) renderProviderState(state);
  showToast(response.message ?? "代理订阅更新时间已保存", "success");
}

proxyRefreshInterval.addEventListener("change", () => {
  const custom = proxyRefreshInterval.value === "custom";
  proxyRefreshCustomGroup.hidden = !custom;
  if (custom) {
    proxyRefreshCustomValue.focus();
    proxyRefreshCustomValue.select();
    return;
  }
  void saveProxyRefreshInterval()
    .catch((error) => showToast(error instanceof Error ? error.message : "更新时间保存失败", "error"));
});
proxyRefreshCustomValue.addEventListener("change", () => {
  void saveProxyRefreshInterval()
    .catch((error) => showToast(error instanceof Error ? error.message : "更新时间保存失败", "error"));
});
proxyRefreshCustomUnit.addEventListener("change", () => {
  setCustomIntervalInputLimit(proxyRefreshCustomValue, proxyRefreshCustomUnit.value as RefreshUnit);
  void saveProxyRefreshInterval()
    .catch((error) => showToast(error instanceof Error ? error.message : "更新时间保存失败", "error"));
});
