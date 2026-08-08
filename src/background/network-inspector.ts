import {
  beginNetworkInfoCheck,
  finishNetworkInfoCheck,
  runExclusiveProxyMutation,
} from "../proxy/proxy-manager.ts";
import type {
  NetworkInfoCache,
  NetworkInfoResult,
  NetworkRouteInfo,
} from "../shared/network-types.ts";
import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";

export interface NetworkInspection {
  data: NetworkInfoResult;
  message: string;
}

function isLikelyIp(value: string): boolean {
  return value.length > 0 && value.length <= 45 && /^[0-9a-f:.]+$/i.test(value);
}

export function parseIpipCurrentInfo(text: string, requestMs: number): NetworkRouteInfo {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:IP|ip)\s*[：:]?\s*([0-9a-f:.]+)(?:\s+来自于[：:]?\s*(.*))?/);
  const ip = match?.[1]?.trim() ?? "";

  if (!isLikelyIp(ip)) {
    throw new Error("IPIP 未返回有效的直连出口 IP");
  }

  const location = match?.[2]?.trim();
  const parts = location ? location.split(/\s+/).filter(Boolean) : [];
  const country = parts[0];

  return {
    ip,
    requestMs,
    country,
    countryCode: country === "中国" ? "CN" : undefined,
    region: parts[1],
    city: parts[2],
    isp: parts.length > 3 ? parts.slice(3).join(" ") : undefined,
  };
}

export function parseIpSbGeo(value: Record<string, unknown>, requestMs: number): NetworkRouteInfo {
  const ip = typeof value.ip === "string" ? value.ip.trim() : "";
  if (!isLikelyIp(ip)) {
    throw new Error("IP.SB 未返回有效的代理出口 IP");
  }

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

export function inspectNetworkInfo(): Promise<NetworkInspection> {
  return runExclusiveProxyMutation(async () => {
    const config = await beginNetworkInfoCheck();
    let directResult: PromiseSettledResult<NetworkRouteInfo>;
    let proxyResult: PromiseSettledResult<NetworkRouteInfo>;

    try {
      // 只发两次并行请求：IPIP 的响应本身带直连归属地；
      // IP.SB /geoip 一次返回代理出口 IP + GeoIP。
      const directStartedAt = performance.now();
      const directRequest = fetch(`https://myip.ipip.net/?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`IPIP 返回 HTTP ${response.status}`);
        const text = await response.text();
        const requestMs = Math.max(1, Math.round(performance.now() - directStartedAt));
        return parseIpipCurrentInfo(text, requestMs);
      });

      const proxyStartedAt = performance.now();
      const proxyRequest = fetch(`https://api.ip.sb/geoip?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`IP.SB 返回 HTTP ${response.status}`);
        const value = await response.json() as Record<string, unknown>;
        const requestMs = Math.max(1, Math.round(performance.now() - proxyStartedAt));
        return parseIpSbGeo(value, requestMs);
      });

      [directResult, proxyResult] = await Promise.allSettled([directRequest, proxyRequest]);
    } finally {
      // 探测期间使用临时 PAC；无论成功失败都恢复用户原来的代理状态。
      await finishNetworkInfoCheck();
    }

    const direct = directResult.status === "fulfilled" ? directResult.value : undefined;
    const proxy = proxyResult.status === "fulfilled" ? proxyResult.value : undefined;
    const directError = directResult.status === "rejected"
      ? (directResult.reason instanceof Error ? directResult.reason.message : String(directResult.reason))
      : undefined;
    const proxyError = proxyResult.status === "rejected"
      ? (proxyResult.reason instanceof Error ? proxyResult.reason.message : String(proxyResult.reason))
      : undefined;
    const sameExitIp = Boolean(direct && proxy && direct.ip === proxy.ip);
    const cache: NetworkInfoCache = {
      host: config.host,
      port: config.port,
      checkedAt: new Date().toISOString(),
      direct,
      proxy,
      directError,
      proxyError,
      sameExitIp,
    };

    await chrome.storage.local.set({ [NETWORK_INFO_CACHE_KEY]: cache });

    return {
      data: {
        proxyEndpoint: `http://${config.host}:${config.port}`,
        direct,
        proxy,
        directError,
        proxyError,
        sameExitIp,
      },
      message: direct && proxy
        ? sameExitIp
          ? "网络信息已更新；直连与代理出口 IP 相同"
          : "网络信息已更新；代理出口已与本地直连区分"
        : direct || proxy
          ? "网络信息已部分更新"
          : "网络信息获取失败",
    };
  });
}
