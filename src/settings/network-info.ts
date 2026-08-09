import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import type {
  NetworkInfoCache,
  NetworkInfoResult,
  NetworkRouteInfo,
} from "../shared/network-types.ts";
import { networkCacheIsHealthy, networkCacheMatchesProxy } from "../shared/network-health.ts";
import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import { requiredElement } from "./dom.ts";
import { getProviderState } from "./provider-state.ts";
import { formatDateTime, relativeTimeLabel, timeAgeMs } from "./relative-time.ts";
import { sendMessage } from "./runtime-client.ts";
import { setStatusBadge } from "./status-badge.ts";
import { showToast } from "./toast.ts";

const NETWORK_FRESH_MINUTES = 15;
const NETWORK_STALE_MINUTES = 30;

const proxyHealthBadge = requiredElement<HTMLElement>("#proxy-health-badge");
const proxyHealthText = requiredElement<HTMLElement>("#proxy-health-text");
const refreshNetworkInfoButton = requiredElement<HTMLButtonElement>("#refresh-network-info");
const networkLastChecked = requiredElement<HTMLElement>("#network-last-checked");
const directExitIp = requiredElement<HTMLElement>("#direct-exit-ip");
const directExitLocation = requiredElement<HTMLElement>("#direct-exit-location");
const directExitNetwork = requiredElement<HTMLElement>("#direct-exit-network");
const proxyExitIp = requiredElement<HTMLElement>("#proxy-exit-ip");
const proxyExitLocation = requiredElement<HTMLElement>("#proxy-exit-location");
const proxyExitNetwork = requiredElement<HTMLElement>("#proxy-exit-network");
const copyIpButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-copy-ip]"));

let currentNetworkCheckedAt: string | undefined;

function updateNetworkFreshness(): void {
  const ageMs = timeAgeMs(currentNetworkCheckedAt);
  if (!Number.isFinite(ageMs)) {
    setStatusBadge(networkLastChecked, "尚未检测", "idle");
    return;
  }

  const minutes = Math.floor(ageMs / 60_000);
  const relative = minutes < 1 ? "刚刚检测" : relativeTimeLabel(currentNetworkCheckedAt);
  const title = formatDateTime(currentNetworkCheckedAt);

  if (minutes < NETWORK_FRESH_MINUTES) {
    setStatusBadge(networkLastChecked, relative, "fresh", title, true);
  } else if (minutes < NETWORK_STALE_MINUTES) {
    setStatusBadge(networkLastChecked, relative, "stale", title);
  } else {
    setStatusBadge(networkLastChecked, `${relative} · 建议刷新`, "error", title);
  }
}

function formatNetworkLocation(info: NetworkRouteInfo): string {
  const location = [info.country, info.region, info.city]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" · ");
  const countryCode = info.countryCode?.trim().toUpperCase();
  return [location || "位置未知", countryCode].filter(Boolean).join(" · ");
}

function setHealth(healthy: boolean, checking = false): void {
  proxyHealthBadge.dataset.state = checking ? "checking" : healthy ? "healthy" : "unhealthy";
  proxyHealthText.textContent = checking ? "代理检测中" : healthy ? "代理健康" : "代理异常";
  const symbol = proxyHealthBadge.querySelector<SVGPathElement>("[data-health-symbol]");
  const classes = checking
    ? ["border-amber-100 dark:border-[#ff9f0a]/40", "bg-amber-50 dark:bg-[#ff9f0a]/15", "text-amber-700 dark:text-[#ff9f0a]"]
    : healthy
      ? ["border-emerald-100 dark:border-[#30d158]/35", "bg-emerald-50 dark:bg-[#30d158]/15", "text-emerald-700 dark:text-[#30d158]"]
      : ["border-red-100 dark:border-[#ff453a]/40", "bg-red-50 dark:bg-[#ff453a]/15", "text-red-700 dark:text-[#ff453a]"];
  proxyHealthBadge.className = `inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-extrabold ${classes[0]} ${classes[1]} ${classes[2]}`;
  if (symbol) {
    symbol.setAttribute("d", checking ? "M8 12h2m4 0h2" : healthy ? "M7 12h10" : "M7 12h3m4 0h3");
  }
}

function cacheMatchesActive(cache: unknown, state: ProxyProviderState): cache is NetworkInfoCache {
  return networkCacheMatchesProxy(cache, state);
}

function resetNetworkInfo(): void {
  directExitIp.textContent = "—";
  directExitLocation.textContent = "—";
  directExitNetwork.textContent = "—";
  proxyExitIp.textContent = "—";
  proxyExitLocation.textContent = "—";
  proxyExitNetwork.textContent = "—";
  currentNetworkCheckedAt = undefined;
  updateNetworkFreshness();
  setHealth(false);
}

function renderNetworkInfo(cache: NetworkInfoCache): void {
  const direct = cache.direct;
  const proxy = cache.proxy;
  directExitIp.textContent = direct?.ip ?? "获取失败";
  directExitLocation.textContent = direct ? formatNetworkLocation(direct) : cache.directError || "—";
  directExitNetwork.textContent = direct?.isp || (direct ? "运营商未知" : "—");
  proxyExitIp.textContent = proxy?.ip ?? "获取失败";
  proxyExitLocation.textContent = proxy ? formatNetworkLocation(proxy) : cache.proxyError || "—";
  proxyExitNetwork.textContent = proxy?.isp || (proxy ? "运营商未知" : "—");

  currentNetworkCheckedAt = cache.checkedAt;
  updateNetworkFreshness();
  setHealth(networkCacheIsHealthy(cache));
}

export async function restoreNetworkInfoForState(state: ProxyProviderState): Promise<void> {
  const stored = await chrome.storage.local.get(NETWORK_INFO_CACHE_KEY);
  const cache = stored[NETWORK_INFO_CACHE_KEY] as unknown;
  if (cacheMatchesActive(cache, state)) renderNetworkInfo(cache);
  else resetNetworkInfo();
}

async function saveNetworkCache(cache: NetworkInfoCache): Promise<void> {
  await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });
}

export async function refreshNetworkInfo(showProgressToast = true): Promise<void> {
  const providerState = getProviderState();
  if (!providerState || refreshNetworkInfoButton.dataset.running === "true") return;
  const stateAtStart = providerState;
  refreshNetworkInfoButton.dataset.running = "true";
  refreshNetworkInfoButton.disabled = true;
  refreshNetworkInfoButton.title = "正在刷新网络信息";
  refreshNetworkInfoButton.setAttribute("aria-label", "正在刷新网络信息");
  setHealth(false, true);
  if (showProgressToast) showToast("正在检测两个公网出口…", "info");

  try {
    const response = await sendMessage<NetworkInfoResult>({ type: "GET_NETWORK_INFO" });
    if (!response.ok || !response.data) throw new Error(response.error ?? "网络信息检测失败");

    const current = getProviderState();
    if (!current || current.activeProxy.host !== stateAtStart.activeProxy.host ||
        current.activeProxy.port !== stateAtStart.activeProxy.port) return;

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
    if (showProgressToast) {
      showToast(response.message ?? "网络信息已更新",
        cache.direct && cache.proxy && cache.direct.ip !== cache.proxy.ip ? "success" : "warning");
    }
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
    const current = getProviderState();
    if (current && current.activeProxy.host === stateAtStart.activeProxy.host &&
        current.activeProxy.port === stateAtStart.activeProxy.port) renderNetworkInfo(cache);
    if (showProgressToast) showToast(message, "error");
  } finally {
    refreshNetworkInfoButton.dataset.running = "false";
    refreshNetworkInfoButton.disabled = false;
    refreshNetworkInfoButton.title = "刷新网络信息";
    refreshNetworkInfoButton.setAttribute("aria-label", "刷新网络信息");
  }
}

export function initializeNetworkInfo(state: ProxyProviderState, cache: unknown): void {
  if (cacheMatchesActive(cache, state)) {
    renderNetworkInfo(cache);
    if (timeAgeMs(cache.checkedAt) >= NETWORK_STALE_MINUTES * 60_000) {
      void refreshNetworkInfo(false);
    }
  } else {
    resetNetworkInfo();
  }
}

async function copyIpAddress(route: "direct" | "proxy"): Promise<void> {
  const value = (route === "direct" ? directExitIp : proxyExitIp).textContent?.trim() ?? "";
  if (!value || value === "—" || value === "获取失败") throw new Error("当前没有可复制的 IP 地址");
  await navigator.clipboard.writeText(value);
  showToast(`已复制 ${value}`, "success");
}

refreshNetworkInfoButton.addEventListener("click", () => { void refreshNetworkInfo(); });
for (const button of copyIpButtons) {
  button.addEventListener("click", () => {
    const route = button.dataset.copyIp === "proxy" ? "proxy" : "direct";
    void copyIpAddress(route).catch((error) => {
      showToast(error instanceof Error ? error.message : "复制 IP 地址失败", "error");
    });
  });
}

window.setInterval(updateNetworkFreshness, 60_000);
