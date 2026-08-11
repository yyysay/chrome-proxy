import { NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import { ruleMatchesHostname } from "../proxy/pac-builder.ts";
import { getProxyStatus, reconcileProxy } from "../proxy/pac-controller.ts";
import {
  activateConfigDocument,
  compileConfigRuntime,
  getConfigProviderContent,
  getConfigDocumentState,
  loadActiveConfigRuntime,
  refreshConfigDocumentProviders,
} from "./config-runtime.ts";
import { DEFAULT_REFRESH_INTERVAL_SECONDS } from "./refresh-interval.ts";

async function invalidateNetworkCache(): Promise<void> {
  await chrome.storage.local.remove(NETWORK_INFO_CACHE_KEY);
}

export { getConfigDocumentState };
export { getConfigProviderContent };

export async function applyConfigDocument(yaml: string, sourceUrl = "", refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS): Promise<{
  state: Awaited<ReturnType<typeof getConfigDocumentState>>;
  refreshed: number;
  cached: number;
  pacReapplied: boolean;
}> {
  const result = await activateConfigDocument(yaml, sourceUrl, refreshIntervalSeconds);
  await invalidateNetworkCache();
  const pacReapplied = await reconcileProxy(true);
  return { ...result, pacReapplied };
}

export async function refreshConfigProviders(): Promise<{
  state: Awaited<ReturnType<typeof getConfigDocumentState>>;
  refreshed: number;
  cached: number;
  pacReapplied: boolean;
}> {
  const result = await refreshConfigDocumentProviders();
  const pacReapplied = await reconcileProxy(true);
  return { ...result, pacReapplied };
}

export async function testConfigRuleMatch(input: string): Promise<{
  hostname: string;
  action: string;
  matched: boolean;
  rule?: { type: string; value: string };
}> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请输入网址或域名");
  let hostname: string;
  try {
    hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    throw new Error("网址或域名格式无效");
  }
  if (!hostname) throw new Error("网址或域名格式无效");
  const runtime = await loadActiveConfigRuntime();
  if (!runtime) throw new Error("请先保存并应用 YAML 配置");
  const compiled = compileConfigRuntime(runtime);
  const matched = compiled.rules.find((rule) => ruleMatchesHostname(rule, hostname));
  return matched
    ? { hostname, action: matched.target, matched: true, rule: { type: matched.type, value: matched.value } }
    : { hostname, action: compiled.fallbackTarget, matched: false };
}

export async function getSiteProxyStatus(input: string): Promise<{
  hostname: string;
  action: string;
  proxied: boolean;
  engineEnabled: boolean;
  matched: boolean;
  rule?: { type: string; value: string };
}> {
  const [route, status] = await Promise.all([testConfigRuleMatch(input), getProxyStatus()]);
  return {
    ...route,
    proxied: status.applied && route.action !== "DIRECT",
    engineEnabled: status.applied,
  };
}
