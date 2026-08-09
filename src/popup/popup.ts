import "../ui/ui.css";
import type { ProxyStatus } from "../proxy/proxy-manager";
import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import { networkCacheIsHealthy, networkCacheMatchesProxy } from "../shared/network-health.ts";
import type { NetworkInfoCache } from "../shared/network-types.ts";
import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup 页面缺少必要元素：${selector}`);
  return element;
}

const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const proxyToggleButton = requiredElement<HTMLButtonElement>("#proxy-toggle");
const toggleLabel = requiredElement<HTMLElement>("#toggle-label");
const popupHealthDot = requiredElement<HTMLElement>("#popup-health-dot");

let enabled = false;

async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

function renderStatus(status: ProxyStatus): void {
  enabled = status.desiredEnabled || status.applied;
  proxyToggleButton.disabled = false;
  proxyToggleButton.setAttribute("aria-checked", String(enabled));
  proxyToggleButton.classList.toggle("active", enabled);
  toggleLabel.textContent = enabled ? "ON" : "OFF";
}

function renderHealth(cache: unknown, state: ProxyProviderState): void {
  const healthy = networkCacheMatchesProxy(cache, state) && networkCacheIsHealthy(cache);
  popupHealthDot.className = healthy
    ? "size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.12)] dark:bg-[#30d158] dark:shadow-[0_0_0_3px_rgba(48,209,88,.14)]"
    : "size-2 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,.12)] dark:bg-[#ff453a] dark:shadow-[0_0_0_3px_rgba(255,69,58,.14)]";
  const label = healthy ? "代理健康" : "代理异常或尚未检测";
  popupHealthDot.title = label;
  popupHealthDot.setAttribute("aria-label", label);
}

async function refreshStatus(): Promise<void> {
  const [statusResponse, providerResponse, stored] = await Promise.all([
    sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" }),
    sendMessage<ProxyProviderState>({ type: "GET_PROXY_PROVIDER_STATE" }),
    chrome.storage.local.get(NETWORK_INFO_CACHE_KEY),
  ]);
  if (!statusResponse.ok || !statusResponse.data) {
    throw new Error(statusResponse.error ?? "代理状态读取失败");
  }
  if (!providerResponse.ok || !providerResponse.data) {
    throw new Error(providerResponse.error ?? "代理配置读取失败");
  }
  renderStatus(statusResponse.data);
  renderHealth(stored[NETWORK_INFO_CACHE_KEY] as NetworkInfoCache | undefined, providerResponse.data);
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

proxyToggleButton.addEventListener("click", () => {
  proxyToggleButton.disabled = true;
  void sendMessage({ type: enabled ? "DISABLE_PROXY" : "ENABLE_PROXY" })
    .then(async (response: RuntimeResponse) => {
      if (!response.ok) throw new Error(response.error ?? "操作失败");
      await refreshStatus();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      try {
        await refreshStatus();
      } catch (refreshError) {
        console.error(refreshError);
        proxyToggleButton.disabled = false;
      }
    });
});

void refreshStatus().catch((error: unknown) => {
  console.error(error);
  proxyToggleButton.disabled = false;
});
