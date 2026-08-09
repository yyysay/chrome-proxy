import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import type { NetworkInfoCache } from "./network-types.ts";

export function networkCacheMatchesProxy(
  cache: unknown,
  state: ProxyProviderState,
): cache is NetworkInfoCache {
  if (!cache || typeof cache !== "object") return false;
  const value = cache as Partial<NetworkInfoCache>;
  return value.host === state.activeProxy.host && value.port === state.activeProxy.port &&
    typeof value.checkedAt === "string";
}

export function networkCacheIsHealthy(cache: NetworkInfoCache): boolean {
  return Boolean(cache.direct && cache.proxy && !cache.sameExitIp && cache.direct.ip !== cache.proxy.ip);
}
