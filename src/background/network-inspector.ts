import { beginNetworkInfoCheck, finishNetworkInfoCheck } from "../proxy/network-probe.ts";
import { runExclusiveProxyMutation } from "../proxy/proxy-state.ts";
import type { NetworkInfoCache, NetworkInfoResult, NetworkRouteInfo } from "../shared/network-types.ts";
import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";

interface NetworkInspection {
  data: NetworkInfoResult;
  message: string;
}

function isLikelyIp(value: string): boolean {
  return value.length > 0 && value.length <= 45 && /^[0-9a-f:.]+$/i.test(value);
}

export function parseIpSbGeo(value: Record<string, unknown>, requestMs: number): NetworkRouteInfo {
  const ip = typeof value.ip === "string" ? value.ip.trim() : "";
  if (!isLikelyIp(ip)) throw new Error("IP.SB 未返回有效的出口 IP");
  return {
    ip,
    requestMs,
    country: typeof value.country === "string" ? value.country : undefined,
    countryCode: typeof value.country_code === "string" ? value.country_code.toUpperCase() : undefined,
    region: typeof value.region === "string" ? value.region : undefined,
    city: typeof value.city === "string" ? value.city : undefined,
    isp: typeof value.isp === "string" ? value.isp : undefined,
    asn: typeof value.asn === "number" ? value.asn : undefined,
  };
}

async function inspectProxyExit(): Promise<NetworkRouteInfo> {
  const startedAt = performance.now();
  const response = await fetch(`https://api.ip.sb/geoip?t=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`IP.SB 返回 HTTP ${response.status}`);
  return parseIpSbGeo(
    await response.json() as Record<string, unknown>,
    Math.max(1, Math.round(performance.now() - startedAt)),
  );
}

export function inspectNetworkInfo(nodeName?: string): Promise<NetworkInspection> {
  return runExclusiveProxyMutation(async () => {
    const config = await beginNetworkInfoCheck(nodeName);
    let proxy: NetworkRouteInfo | undefined;
    let proxyError: string | undefined;
    try {
      proxy = await inspectProxyExit();
    } catch (error) {
      proxyError = error instanceof Error ? error.message : String(error);
    } finally {
      await finishNetworkInfoCheck();
    }

    const cache: NetworkInfoCache = {
      nodeName: nodeName ?? "",
      host: config.host,
      port: config.port,
      checkedAt: new Date().toISOString(),
      proxy,
      proxyError,
    };
    await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });
    return {
      data: { proxy, proxyError },
      message: proxy ? "节点出口信息已更新" : "节点出口信息获取失败",
    };
  });
}
