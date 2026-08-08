import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import type { RefreshUnit } from "../shared/refresh-interval.ts";
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
import { showToast } from "./toast.ts";

type ProxySourceMode = ProxyProviderState["sourceMode"];

const openProxySourcePickerButton = requiredElement<HTMLButtonElement>("#open-proxy-source-picker");
const proxySourceValue = requiredElement<HTMLElement>("#proxy-source-value");
const proxySourceSettingsTitle = requiredElement<HTMLElement>("#proxy-source-settings-title");
const proxySourceSettingsDetail = requiredElement<HTMLElement>("#proxy-source-settings-detail");
const proxySourcePickerDialog = requiredElement<HTMLDialogElement>("#proxy-source-picker-dialog");
const proxySourcePickerCloseButton = requiredElement<HTMLButtonElement>("#proxy-source-picker-close");
const proxySourceOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-proxy-source-option]"));
const proxySourceCheckmarks = Array.from(document.querySelectorAll<SVGElement>("[data-proxy-source-check]"));
const subscriptionSettings = requiredElement<HTMLElement>("#subscription-settings");
const manualSettings = requiredElement<HTMLElement>("#manual-settings");
const subscriptionForm = requiredElement<HTMLFormElement>("#subscription-form");
const subscriptionUrlInput = requiredElement<HTMLInputElement>("#subscription-url");
const subscriptionStateBadge = requiredElement<HTMLElement>("#subscription-state-badge");
const refreshProxySubscriptionButton = requiredElement<HTMLButtonElement>("#refresh-proxy-subscription");
const manualProxyForm = requiredElement<HTMLFormElement>("#manual-proxy-form");
const manualHostInput = requiredElement<HTMLInputElement>("#manual-proxy-host");
const manualPortInput = requiredElement<HTMLInputElement>("#manual-proxy-port");
const proxyEditorDialog = requiredElement<HTMLDialogElement>("#proxy-editor-dialog");
const proxyEditorTitle = requiredElement<HTMLElement>("#proxy-editor-title");
const proxyEditorCloseButton = requiredElement<HTMLButtonElement>("#proxy-editor-close");
const openProxyEditorButton = requiredElement<HTMLButtonElement>("#open-proxy-editor");
const proxyRefreshInterval = requiredElement<HTMLSelectElement>("#proxy-refresh-interval");
const proxyRefreshCustomGroup = requiredElement<HTMLElement>("#proxy-refresh-custom-group");
const proxyRefreshCustomValue = requiredElement<HTMLInputElement>("#proxy-refresh-custom-value");
const proxyRefreshCustomUnit = requiredElement<HTMLSelectElement>("#proxy-refresh-custom-unit");

let pendingProxySourceMode: ProxySourceMode | undefined;

function endpointChanged(before: ProxyProviderState | undefined, after: ProxyProviderState): boolean {
  return !before || before.activeProxy.host !== after.activeProxy.host ||
    before.activeProxy.port !== after.activeProxy.port;
}

function validateHost(host: string): boolean {
  return Boolean(host) && !host.includes("://") && !host.includes("/");
}

export function renderProviderState(state: ProxyProviderState): void {
  setProviderState(state);
  proxySourceValue.textContent = state.sourceMode === "subscription" ? "代理订阅" : "手动代理";
  proxySourceSettingsTitle.textContent = state.sourceMode === "subscription" ? "订阅设置" : "手动代理设置";
  subscriptionSettings.hidden = state.sourceMode !== "subscription";
  manualSettings.hidden = state.sourceMode !== "manual";
  subscriptionUrlInput.value = state.subscriptionUrl;
  refreshProxySubscriptionButton.disabled = !state.subscriptionUrl;
  if (state.sourceMode === "subscription" && state.subscription) {
    setRelativeTimeStatus(proxySourceSettingsDetail, state.subscription.fetchedAt, {
      prefix: "上次更新 ",
      baseClass: "mt-0.5 block truncate text-xs font-bold",
      freshMinutes: 360,
      staleMinutes: 1_440,
    });
  } else {
    clearRelativeTimeStatus(proxySourceSettingsDetail);
    proxySourceSettingsDetail.className = "mt-0.5 block truncate text-xs text-stone-400 dark:text-white/40";
    proxySourceSettingsDetail.textContent = state.sourceMode === "subscription"
      ? state.subscriptionError ? "更新失败，请检查订阅" : "订阅尚未更新"
      : state.manualOverride
        ? `${state.manualOverride.host}:${state.manualOverride.port}`
        : "手动代理尚未配置";
  }
  for (const checkmark of proxySourceCheckmarks) {
    if (checkmark.dataset.proxySourceCheck === state.sourceMode) checkmark.removeAttribute("hidden");
    else checkmark.setAttribute("hidden", "");
  }

  if (state.manualOverride) {
    manualHostInput.value = state.manualOverride.host;
    manualPortInput.value = String(state.manualOverride.port);
  }

  const subscriptionFailure = state.subscriptionError || state.subscription?.error;
  if (subscriptionFailure) {
    clearRelativeTimeStatus(subscriptionStateBadge);
    subscriptionStateBadge.dataset.state = "error";
    subscriptionStateBadge.className = "rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-red-700 dark:bg-[#ff453a]/15 dark:text-[#ff453a]";
    subscriptionStateBadge.textContent = "更新失败";
    subscriptionStateBadge.title = subscriptionFailure;
  } else if (state.subscription) {
    subscriptionStateBadge.dataset.state = "ready";
    setRelativeTimeStatus(subscriptionStateBadge, state.subscription.fetchedAt, {
      baseClass: "rounded-full bg-stone-100 px-3 py-1 text-xs font-extrabold dark:bg-white/8",
      freshMinutes: 360,
      staleMinutes: 1_440,
    });
    subscriptionStateBadge.title = `上次更新 ${formatDateTime(state.subscription.fetchedAt)}`;
  } else {
    clearRelativeTimeStatus(subscriptionStateBadge);
    subscriptionStateBadge.dataset.state = "idle";
    subscriptionStateBadge.className = "rounded-full bg-stone-200 px-3 py-1 text-xs font-extrabold text-stone-600 dark:bg-white/10 dark:text-white/65";
    subscriptionStateBadge.textContent = state.subscriptionUrl ? "待更新" : "未配置";
  }
}

function openProxyEditor(mode: ProxySourceMode): void {
  subscriptionSettings.hidden = mode !== "subscription";
  manualSettings.hidden = mode !== "manual";
  proxyEditorTitle.textContent = mode === "subscription" ? "编辑代理订阅" : "编辑手动代理";
  proxyEditorDialog.showModal();
  if (mode === "subscription") subscriptionUrlInput.focus();
  else manualHostInput.focus();
}

async function applyProviderState(state: ProxyProviderState, autoDetect: boolean): Promise<void> {
  renderProviderState(state);
  await restoreNetworkInfoForState(state);
  if (autoDetect) void refreshNetworkInfo(false);
}

export function initializeProxySettings(state: ProxyProviderState, intervalMinutes: number): void {
  renderProviderState(state);
  renderRefreshInterval(
    proxyRefreshInterval,
    proxyRefreshCustomGroup,
    proxyRefreshCustomValue,
    proxyRefreshCustomUnit,
    intervalMinutes,
  );
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
    proxyEditorDialog.close();
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
  proxySourcePickerDialog.close();
  const providerState = getProviderState();
  if (!providerState || mode === providerState.sourceMode) return;

  if (mode === "manual" && !providerState.manualOverride) {
    pendingProxySourceMode = "manual";
    openProxyEditor("manual");
    showToast("请先保存手动代理，保存后会自动切换", "info");
    return;
  }
  if (mode === "subscription" && !providerState.subscription) {
    pendingProxySourceMode = "subscription";
    openProxyEditor("subscription");
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

openProxySourcePickerButton.addEventListener("click", () => proxySourcePickerDialog.showModal());
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
proxySourcePickerCloseButton.addEventListener("click", () => proxySourcePickerDialog.close());
proxySourcePickerDialog.addEventListener("click", (event) => {
  if (event.target === proxySourcePickerDialog) proxySourcePickerDialog.close();
});

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
    proxyEditorDialog.close();
    showToast(response.message ?? "手动代理已保存", "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "手动代理保存失败", "error"));
});

openProxyEditorButton.addEventListener("click", () => {
  pendingProxySourceMode = undefined;
  openProxyEditor(getProviderState()?.sourceMode ?? "subscription");
});
proxyEditorCloseButton.addEventListener("click", () => {
  pendingProxySourceMode = undefined;
  proxyEditorDialog.close();
});
proxyEditorDialog.addEventListener("click", (event) => {
  if (event.target === proxyEditorDialog) {
    pendingProxySourceMode = undefined;
    proxyEditorDialog.close();
  }
});
proxyEditorDialog.addEventListener("close", () => { pendingProxySourceMode = undefined; });

async function saveProxyRefreshInterval(): Promise<void> {
  const intervalMinutes = selectedRefreshInterval(
    proxyRefreshInterval,
    proxyRefreshCustomValue,
    proxyRefreshCustomUnit,
  );
  const response = await sendMessage({ type: "UPDATE_PROXY_SUBSCRIPTION_REFRESH", intervalMinutes });
  if (!response.ok) throw new Error(response.error ?? "更新时间保存失败");
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
