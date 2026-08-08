import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import { reconcileProxy } from "./pac-controller.ts";
import {
  getProxyProviderState,
  refreshProxySubscription as refreshProxyProviderSubscription,
  saveManualProxy,
  saveProxySubscriptionUrl,
  setProxySourceMode,
  type ProxyProviderState,
  type ProxySourceMode,
} from "./proxy-provider.ts";

async function invalidateNetworkCacheIfEndpointChanged(
  before: ProxyProviderState,
  after: ProxyProviderState,
): Promise<boolean> {
  const changed = before.activeProxy.host !== after.activeProxy.host ||
    before.activeProxy.port !== after.activeProxy.port;
  if (changed) await chrome.storage.local.remove(NETWORK_INFO_CACHE_KEY);
  return changed;
}

export async function getProxyProviderSettings(): Promise<ProxyProviderState> {
  return getProxyProviderState();
}

export async function updateProxySourceMode(mode: ProxySourceMode): Promise<{
  state: ProxyProviderState;
  pacReapplied: boolean;
}> {
  const before = await getProxyProviderState();
  if (mode === "manual" && !before.manualOverride) {
    throw new Error("请先保存手动代理地址");
  }
  const state = await setProxySourceMode(mode);
  const changed = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = await reconcileProxy(
    "proxySource.updated",
    changed || before.effectiveSource !== state.effectiveSource,
  );
  return { state, pacReapplied };
}

export async function saveManualProxyConfig(host: string, port: number): Promise<{
  state: ProxyProviderState;
  pacReapplied: boolean;
}> {
  const before = await getProxyProviderState();
  await saveManualProxy(host, port);
  // 第一次保存手动地址就同时启用手动覆盖，避免先切模式但没有地址的死锁。
  const state = await setProxySourceMode("manual");
  const changed = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = await reconcileProxy(
    "manualProxy.updated",
    changed || before.effectiveSource !== state.effectiveSource,
  );
  return { state, pacReapplied };
}

export async function updateProxySubscriptionUrl(url: string): Promise<{
  state: ProxyProviderState;
  endpointChanged: boolean;
  usedCached: boolean;
  pacReapplied: boolean;
  updateFailed?: string;
}> {
  const before = await getProxyProviderState();
  let state = await saveProxySubscriptionUrl(url);
  let usedCached = false;
  let updateFailed: string | undefined;

  if (url.trim()) {
    try {
      const refreshed = await refreshProxyProviderSubscription();
      state = refreshed.state;
      usedCached = refreshed.usedCached;
    } catch (error) {
      updateFailed = error instanceof Error ? error.message : "代理订阅更新失败";
      state = await getProxyProviderState();
    }
  }

  const endpointChanged = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = state.sourceMode === "subscription"
    ? await reconcileProxy("proxySubscription.updated", true)
    : false;
  return { state, endpointChanged, usedCached, pacReapplied, updateFailed };
}

export async function refreshProxySubscription(): Promise<{
  state: ProxyProviderState;
  endpointChanged: boolean;
  usedCached: boolean;
  pacReapplied: boolean;
  updateFailed?: string;
}> {
  const before = await getProxyProviderState();
  let state: ProxyProviderState;
  let usedCached = false;
  let updateFailed: string | undefined;

  try {
    const refreshed = await refreshProxyProviderSubscription();
    state = refreshed.state;
    usedCached = refreshed.usedCached;
  } catch (error) {
    updateFailed = error instanceof Error ? error.message : "代理订阅更新失败";
    state = await getProxyProviderState();
  }

  const endpointChanged = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = state.sourceMode === "subscription" && endpointChanged
    ? await reconcileProxy("proxySubscription.refreshed", true)
    : false;
  return { state, endpointChanged, usedCached, pacReapplied, updateFailed };
}
