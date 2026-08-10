import type { ConfigDocumentState } from "../config/config-runtime.ts";
import type { NetworkInfoCache, NetworkInfoResult, NetworkRouteInfo } from "../shared/network-types.ts";
import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import { requiredElement } from "./dom.ts";
import { formatDateTime, relativeTimeLabel, timeAgeMs } from "./relative-time.ts";
import { sendMessage } from "./runtime-client.ts";
import { setStatusBadge } from "./status-badge.ts";
import { showToast } from "./toast.ts";

type ConfigNode = ConfigDocumentState["nodes"][number];
const NETWORK_STALE_MINUTES = 30;
const nodeSelect = requiredElement<HTMLSelectElement>("#network-node-select");
const nodeName = requiredElement<HTMLElement>("#network-node-name");
const refreshButton = requiredElement<HTMLButtonElement>("#refresh-network-info");
const lastChecked = requiredElement<HTMLElement>("#network-last-checked");
const proxyIp = requiredElement<HTMLElement>("#proxy-exit-ip");
const proxyLocation = requiredElement<HTMLElement>("#proxy-exit-location");
const proxyNetwork = requiredElement<HTMLElement>("#proxy-exit-network");
const copyButton = requiredElement<HTMLButtonElement>('[data-copy-ip="proxy"]');
let nodes: ConfigNode[] = [];
let cache: NetworkInfoCache | undefined;
let currentCheckedAt: string | undefined;

function selectedNode(): ConfigNode | undefined {
  return nodes.find((node) => node.name === nodeSelect.value);
}

function updateFreshness(): void {
  const ageMs = timeAgeMs(currentCheckedAt);
  if (!Number.isFinite(ageMs)) { setStatusBadge(lastChecked, "尚未检测", "idle"); return; }
  const minutes = Math.floor(ageMs / 60_000);
  const label = minutes < 1 ? "刚刚检测" : relativeTimeLabel(currentCheckedAt);
  setStatusBadge(lastChecked, minutes < NETWORK_STALE_MINUTES ? label : `${label} · 建议刷新`, minutes < NETWORK_STALE_MINUTES ? "fresh" : "stale", formatDateTime(currentCheckedAt));
}

function formatLocation(info: NetworkRouteInfo): string {
  return [[info.country, info.region, info.city].filter(Boolean).join(" · ") || "位置未知", info.countryCode]
    .flat().filter(Boolean).join(" · ");
}

export function resetNetworkInfo(): void {
  nodeName.textContent = selectedNode()?.name ?? "未选择节点";
  proxyIp.textContent = proxyLocation.textContent = proxyNetwork.textContent = "—";
  currentCheckedAt = undefined;
  updateFreshness();
}

function render(value: NetworkInfoCache): void {
  nodeName.textContent = value.nodeName || selectedNode()?.name || "代理节点";
  proxyIp.textContent = value.proxy?.ip ?? "获取失败";
  proxyLocation.textContent = value.proxy ? formatLocation(value.proxy) : value.proxyError || "—";
  proxyNetwork.textContent = value.proxy?.isp || (value.proxy ? "运营商未知" : "—");
  currentCheckedAt = value.checkedAt;
  updateFreshness();
}

function renderSelectedCache(): void {
  const node = selectedNode();
  if (node && cache?.nodeName === node.name && cache.host === node.host && cache.port === node.port) render(cache);
  else resetNetworkInfo();
}

export function setNetworkNodes(nextNodes: ConfigNode[]): void {
  const previous = nodeSelect.value;
  nodes = nextNodes;
  nodeSelect.replaceChildren(...nodes.map((node) => {
    const option = document.createElement("option");
    option.value = node.name;
    option.textContent = `${node.name} · ${node.host}:${node.port}`;
    return option;
  }));
  nodeSelect.value = nodes.some((node) => node.name === previous) ? previous : nodes[0]?.name ?? "";
  nodeSelect.disabled = nodes.length === 0;
  refreshButton.disabled = nodes.length === 0;
  renderSelectedCache();
}

export function initializeNetworkInfo(storedCache: unknown, configState: ConfigDocumentState): void {
  cache = storedCache && typeof storedCache === "object" ? storedCache as NetworkInfoCache : undefined;
  setNetworkNodes(configState.nodes);
}

async function refreshNetworkInfo(): Promise<void> {
  const node = selectedNode();
  if (!node) throw new Error("请先在配置中添加并应用节点");
  refreshButton.disabled = true;
  showToast(`正在检测 ${node.name} 的出口…`, "info");
  try {
    const response = await sendMessage<NetworkInfoResult>({ type: "GET_NETWORK_INFO", nodeName: node.name });
    if (!response.ok || !response.data) throw new Error(response.error ?? "节点出口检测失败");
    cache = {
      nodeName: node.name,
      host: node.host,
      port: node.port,
      checkedAt: new Date().toISOString(),
      proxy: response.data.proxy,
      proxyError: response.data.proxyError,
    };
    await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });
    render(cache);
    showToast(response.message ?? "节点出口信息已更新", cache.proxy ? "success" : "warning");
  } finally {
    refreshButton.disabled = nodes.length === 0;
  }
}

nodeSelect.addEventListener("change", renderSelectedCache);
refreshButton.addEventListener("click", () => void refreshNetworkInfo().catch((error) => showToast(error instanceof Error ? error.message : "节点出口检测失败", "error")));
copyButton.addEventListener("click", () => {
  const value = proxyIp.textContent?.trim() ?? "";
  if (!value || value === "—" || value === "获取失败") { showToast("当前没有可复制的出口 IP", "warning"); return; }
  void navigator.clipboard.writeText(value).then(() => showToast(`已复制 ${value}`, "success"));
});
window.setInterval(updateFreshness, 60_000);
