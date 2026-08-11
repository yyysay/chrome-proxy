import { parseRules } from "../rules/parser.ts";
import {
  CONFIG_DOCUMENT_ACTIVE_KEY,
  CONFIG_DOCUMENT_REMOTE_STATUS_KEY,
  CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY,
  CONFIG_DOCUMENT_URL_KEY,
  CONFIG_DOCUMENT_YAML_KEY,
  CONFIG_PROVIDER_CACHE_KEY,
} from "../shared/storage-keys.ts";
import type { PacTargetedRule } from "../proxy/pac-builder.ts";
import {
  validateConfigDocument,
  type ConfigRuleProvider,
  type MinimalConfigDocument,
} from "./config-document.ts";
import { parseConfigRuleProvider } from "./rule-provider-parser.ts";
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  isSelectableRefreshInterval,
} from "./refresh-interval.ts";

const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_REMOTE_CONFIG_BYTES = 256 * 1024;
const LEGACY_CONFIG_REFRESH_INTERVAL_KEY = "configDocumentRefreshIntervalHours";
export const CONFIG_PROVIDER_REFRESH_ALARM = "refresh-config-providers";
export const REMOTE_CONFIG_REFRESH_ALARM = "refresh-remote-config";

interface ConfigProviderCache {
  url: string;
  content: string;
  fetchedAt: string;
  lastAttemptAt: string;
  status: "ready" | "cached";
  error?: string;
}

type ConfigProviderCaches = Record<string, ConfigProviderCache>;

interface RemoteConfigStatus {
  lastAttemptAt: string;
  fetchedAt?: string;
  error?: string;
}

export interface ConfigDocumentState {
  active: boolean;
  yaml: string;
  sourceUrl: string;
  remote: {
    status: "local" | "ready" | "error";
    intervalSeconds: number;
    lastAttemptAt?: string;
    fetchedAt?: string;
    error?: string;
  };
  nodes: Array<{ name: string; host: string; port: number }>;
  providers: Record<string, {
    status: "missing" | "ready" | "cached";
    fetchedAt?: string;
    lastAttemptAt?: string;
    ruleCount?: number;
    error?: string;
  }>;
}

interface ActiveConfigRuntime {
  document: MinimalConfigDocument;
  caches: ConfigProviderCaches;
  sourceUrl: string;
}

interface ConfigProxyNode {
  name: string;
  host: string;
  port: number;
}

interface CompiledConfigRuntime {
  rules: PacTargetedRule[];
  fallbackTarget: string;
  proxies: Map<string, { host: string; port: number }>;
  providerHosts: string[];
}

function isProviderCache(value: unknown): value is ConfigProviderCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cache = value as Partial<ConfigProviderCache>;
  return typeof cache.url === "string" && typeof cache.content === "string" &&
    typeof cache.fetchedAt === "string" && typeof cache.lastAttemptAt === "string" &&
    (cache.status === "ready" || cache.status === "cached");
}

async function loadProviderCaches(): Promise<ConfigProviderCaches> {
  const stored = await chrome.storage.local.get(CONFIG_PROVIDER_CACHE_KEY);
  const value = stored[CONFIG_PROVIDER_CACHE_KEY] as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ConfigProviderCache] => isProviderCache(entry[1])),
  );
}

function isRemoteConfigStatus(value: unknown): value is RemoteConfigStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Partial<RemoteConfigStatus>;
  return typeof status.lastAttemptAt === "string" &&
    (status.fetchedAt === undefined || typeof status.fetchedAt === "string") &&
    (status.error === undefined || typeof status.error === "string");
}

async function loadRemoteConfigStatus(): Promise<RemoteConfigStatus | undefined> {
  const stored = await chrome.storage.local.get(CONFIG_DOCUMENT_REMOTE_STATUS_KEY);
  const value = stored[CONFIG_DOCUMENT_REMOTE_STATUS_KEY];
  return isRemoteConfigStatus(value) ? value : undefined;
}

async function fetchProvider(provider: ConfigRuleProvider): Promise<ConfigProviderCache> {
  const lastAttemptAt = new Date().toISOString();
  const response = await fetch(provider.url, {
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_BYTES) {
    throw new Error("规则包超过 2 MB 限制");
  }
  const content = await response.text();
  if (new TextEncoder().encode(content).byteLength > MAX_PROVIDER_BYTES) {
    throw new Error("规则包超过 2 MB 限制");
  }
  parseConfigRuleProvider(provider, content);
  return {
    url: provider.url,
    content,
    fetchedAt: new Date().toISOString(),
    lastAttemptAt,
    status: "ready",
  };
}

function activeRuleProviders(document: MinimalConfigDocument): ConfigRuleProvider[] {
  const referenced = new Set(document.rules.flatMap((rule) => {
    const parts = rule.split(",").map((part) => part.trim());
    return parts[0]?.toUpperCase() === "RULE-SET" && parts[1] ? [parts[1]] : [];
  }));
  return Object.values(document.ruleProviders).filter((provider) => referenced.has(provider.name));
}

async function updateProviders(
  document: MinimalConfigDocument,
  previous: ConfigProviderCaches,
  dueOnly = false,
): Promise<{ caches: ConfigProviderCaches; refreshed: number; cached: number }> {
  const entries = await Promise.all(activeRuleProviders(document).map(async (provider) => {
    const previousCache = previous[provider.name];
    const lastAttemptAt = Date.parse(previousCache?.lastAttemptAt ?? "");
    const isDue = !previousCache || previousCache.url !== provider.url ||
      !Number.isFinite(lastAttemptAt) || Date.now() - lastAttemptAt >= provider.interval * 1000;
    if (dueOnly && !isDue) {
      return [provider.name, previousCache, "skipped"] as const;
    }
    try {
      return [provider.name, await fetchProvider(provider), "refreshed"] as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : "规则包下载失败";
      const cached = previousCache;
      if (!cached || cached.url !== provider.url) {
        throw new Error(`${provider.name} 下载失败：${message}`);
      }
      try {
        parseConfigRuleProvider(provider, cached.content);
      } catch {
        throw new Error(`${provider.name} 下载失败且旧缓存无效：${message}`);
      }
      return [provider.name, {
        ...cached,
        lastAttemptAt: new Date().toISOString(),
        status: "cached" as const,
        error: message,
      }, "cached"] as const;
    }
  }));

  return {
    caches: Object.fromEntries(entries.map(([name, cache]) => [name, cache])),
    refreshed: entries.filter((entry) => entry[2] === "refreshed").length,
    cached: entries.filter((entry) => entry[2] === "cached").length,
  };
}

async function readStoredDocument(): Promise<{
  active: boolean;
  yaml: string;
  sourceUrl: string;
  refreshIntervalSeconds: number;
  document?: MinimalConfigDocument;
}> {
  const stored = await chrome.storage.local.get([
    CONFIG_DOCUMENT_ACTIVE_KEY,
    CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY,
    LEGACY_CONFIG_REFRESH_INTERVAL_KEY,
    CONFIG_DOCUMENT_URL_KEY,
    CONFIG_DOCUMENT_YAML_KEY,
  ]);
  const yaml = typeof stored[CONFIG_DOCUMENT_YAML_KEY] === "string"
    ? stored[CONFIG_DOCUMENT_YAML_KEY]
    : "";
  const validation = validateConfigDocument(yaml);
  return {
    active: stored[CONFIG_DOCUMENT_ACTIVE_KEY] === true && validation.ok,
    yaml,
    sourceUrl: typeof stored[CONFIG_DOCUMENT_URL_KEY] === "string"
      ? stored[CONFIG_DOCUMENT_URL_KEY]
      : "",
    refreshIntervalSeconds: isSelectableRefreshInterval(Number(stored[CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY]), true)
      ? Number(stored[CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY])
      : isSelectableRefreshInterval(Number(stored[LEGACY_CONFIG_REFRESH_INTERVAL_KEY]) * 3600, true)
        ? Number(stored[LEGACY_CONFIG_REFRESH_INTERVAL_KEY]) * 3600
        : DEFAULT_REFRESH_INTERVAL_SECONDS,
    document: validation.document,
  };
}

export async function getConfigDocumentState(): Promise<ConfigDocumentState> {
  const [stored, caches, remoteStatus] = await Promise.all([
    readStoredDocument(),
    loadProviderCaches(),
    loadRemoteConfigStatus(),
  ]);
  const providers: ConfigDocumentState["providers"] = {};
  for (const provider of Object.values(stored.document?.ruleProviders ?? {})) {
    const cache = caches[provider.name];
    providers[provider.name] = cache?.url === provider.url
      ? {
          status: cache.status,
          fetchedAt: cache.fetchedAt,
          lastAttemptAt: cache.lastAttemptAt,
          ruleCount: parseConfigRuleProvider(provider, cache.content).length,
          error: cache.error,
        }
      : { status: "missing" };
  }
  return {
    active: stored.active,
    yaml: stored.yaml,
    sourceUrl: stored.sourceUrl,
    remote: {
      status: !stored.sourceUrl ? "local" : remoteStatus?.error ? "error" : "ready",
      intervalSeconds: stored.refreshIntervalSeconds,
      lastAttemptAt: remoteStatus?.lastAttemptAt,
      fetchedAt: remoteStatus?.fetchedAt,
      error: remoteStatus?.error,
    },
    nodes: (stored.document?.proxies ?? []).map((node) => ({
      name: node.name,
      host: node.server,
      port: node.port,
    })),
    providers,
  };
}

export async function activateConfigDocument(yaml: string, sourceUrl = "", refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS): Promise<{
  state: ConfigDocumentState;
  refreshed: number;
  cached: number;
}> {
  const validation = validateConfigDocument(yaml);
  if (!validation.ok || !validation.document) {
    throw new Error(validation.issues[0] ?? "配置无效");
  }
  let normalizedSourceUrl = "";
  if (sourceUrl) {
    try {
      const parsedSourceUrl = new URL(sourceUrl);
      if (parsedSourceUrl.protocol !== "http:" && parsedSourceUrl.protocol !== "https:") throw new Error();
      normalizedSourceUrl = parsedSourceUrl.href;
    } catch {
      throw new Error("远程 YAML 来源地址无效");
    }
  }
  if (normalizedSourceUrl && !isSelectableRefreshInterval(refreshIntervalSeconds, true)) {
    throw new Error("远程订阅自动更新周期无效");
  }
  const previous = await loadProviderCaches();
  const updated = await updateProviders(validation.document, previous);
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [CONFIG_DOCUMENT_ACTIVE_KEY]: true,
    [CONFIG_DOCUMENT_URL_KEY]: normalizedSourceUrl,
    [CONFIG_DOCUMENT_YAML_KEY]: yaml,
    [CONFIG_PROVIDER_CACHE_KEY]: updated.caches,
    ...(normalizedSourceUrl
      ? {
          [CONFIG_DOCUMENT_REMOTE_STATUS_KEY]: { lastAttemptAt: now, fetchedAt: now },
          [CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY]: refreshIntervalSeconds,
        }
      : {}),
  });
  if (!normalizedSourceUrl) {
    await chrome.storage.local.remove([
      CONFIG_DOCUMENT_REMOTE_STATUS_KEY,
      CONFIG_DOCUMENT_REFRESH_INTERVAL_KEY,
    ]);
  }
  await chrome.storage.local.remove(LEGACY_CONFIG_REFRESH_INTERVAL_KEY);
  await syncConfigRefreshAlarms();
  return {
    state: await getConfigDocumentState(),
    refreshed: updated.refreshed,
    cached: updated.cached,
  };
}

export async function refreshConfigDocumentProviders(dueOnly = false): Promise<{
  state: ConfigDocumentState;
  refreshed: number;
  cached: number;
}> {
  const stored = await readStoredDocument();
  if (!stored.active || !stored.document) throw new Error("尚未应用测试配置");
  const previous = await loadProviderCaches();
  const updated = await updateProviders(stored.document, previous, dueOnly);
  await chrome.storage.local.set({ [CONFIG_PROVIDER_CACHE_KEY]: updated.caches });
  return {
    state: await getConfigDocumentState(),
    refreshed: updated.refreshed,
    cached: updated.cached,
  };
}

export async function deactivateConfigDocument(): Promise<ConfigDocumentState> {
  await chrome.storage.local.set({ [CONFIG_DOCUMENT_ACTIVE_KEY]: false });
  if (chrome.alarms) await chrome.alarms.clear(CONFIG_PROVIDER_REFRESH_ALARM);
  if (chrome.alarms) await chrome.alarms.clear(REMOTE_CONFIG_REFRESH_ALARM);
  return getConfigDocumentState();
}

async function fetchRemoteConfigYaml(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_CONFIG_BYTES) {
    throw new Error("远程 YAML 超过 256 KB 限制");
  }
  const yaml = await response.text();
  if (new TextEncoder().encode(yaml).byteLength > MAX_REMOTE_CONFIG_BYTES) {
    throw new Error("远程 YAML 超过 256 KB 限制");
  }
  return yaml;
}

export async function refreshRemoteConfigDocument(): Promise<{
  state: ConfigDocumentState;
  refreshed: number;
  cached: number;
}> {
  const stored = await readStoredDocument();
  if (!stored.active || !stored.sourceUrl) throw new Error("当前未使用远程 YAML 订阅");
  const previousStatus = await loadRemoteConfigStatus();
  const lastAttemptAt = new Date().toISOString();
  try {
    const yaml = await fetchRemoteConfigYaml(stored.sourceUrl);
    return await activateConfigDocument(yaml, stored.sourceUrl, stored.refreshIntervalSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "远程 YAML 同步失败";
    await chrome.storage.local.set({
      [CONFIG_DOCUMENT_REMOTE_STATUS_KEY]: {
        lastAttemptAt,
        fetchedAt: previousStatus?.fetchedAt,
        error: message,
      },
    });
    throw new Error(`远程 YAML 自动同步失败：${message}`);
  }
}

export async function syncConfigProviderRefreshAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  const stored = await readStoredDocument();
  const intervals = stored.document
    ? activeRuleProviders(stored.document).map((provider) => provider.interval)
    : [];
  if (!stored.active || intervals.length === 0) {
    await chrome.alarms.clear(CONFIG_PROVIDER_REFRESH_ALARM);
    return;
  }
  await chrome.alarms.create(CONFIG_PROVIDER_REFRESH_ALARM, {
    periodInMinutes: Math.max(1, Math.min(...intervals) / 60),
  });
}

export async function syncRemoteConfigRefreshAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  const stored = await readStoredDocument();
  if (!stored.active || !stored.sourceUrl || stored.refreshIntervalSeconds === 0) {
    await chrome.alarms.clear(REMOTE_CONFIG_REFRESH_ALARM);
    return;
  }
  await chrome.alarms.create(REMOTE_CONFIG_REFRESH_ALARM, {
    periodInMinutes: Math.max(1, stored.refreshIntervalSeconds / 60),
  });
}

export async function syncConfigRefreshAlarms(): Promise<void> {
  await Promise.all([syncConfigProviderRefreshAlarm(), syncRemoteConfigRefreshAlarm()]);
}

export async function getConfigProviderContent(name: string): Promise<{
  name: string;
  url: string;
  content: string;
  ruleCount: number;
  fetchedAt: string;
  lastAttemptAt: string;
  status: "ready" | "cached";
  error?: string;
}> {
  const [stored, caches] = await Promise.all([readStoredDocument(), loadProviderCaches()]);
  const provider = stored.document?.ruleProviders[name];
  if (!provider) throw new Error(`配置中不存在规则包：${name}`);
  const cache = caches[name];
  if (!cache || cache.url !== provider.url) throw new Error(`${name} 尚无可查看的缓存`);
  return {
    name,
    url: provider.url,
    content: cache.content,
    ruleCount: parseConfigRuleProvider(provider, cache.content).length,
    fetchedAt: cache.fetchedAt,
    lastAttemptAt: cache.lastAttemptAt,
    status: cache.status,
    error: cache.error,
  };
}

export async function loadActiveConfigRuntime(): Promise<ActiveConfigRuntime | undefined> {
  const [stored, caches] = await Promise.all([readStoredDocument(), loadProviderCaches()]);
  if (!stored.active || !stored.document) return undefined;
  for (const provider of activeRuleProviders(stored.document)) {
    const cache = caches[provider.name];
    if (!cache || cache.url !== provider.url) throw new Error(`${provider.name} 尚无可用缓存`);
  }
  return { document: stored.document, caches, sourceUrl: stored.sourceUrl };
}

function targetForRule(rawRule: string): string {
  const parts = rawRule.split(",").map((part) => part.trim());
  return parts[0]?.toUpperCase() === "MATCH" ? parts[1] : parts[2];
}

export function compileConfigRuntime(runtime: ActiveConfigRuntime): CompiledConfigRuntime {
  const rules: PacTargetedRule[] = [];
  const seen = new Map<string, string>();
  let fallbackTarget = "DIRECT";

  const append = (rule: PacTargetedRule): void => {
    const key = `${rule.type}:${rule.value}`;
    const previousTarget = seen.get(key);
    if (previousTarget !== undefined) return;
    seen.set(key, rule.target);
    rules.push(rule);
  };

  runtime.document.rules.forEach((rawRule) => {
    const parts = rawRule.split(",").map((part) => part.trim());
    const type = parts[0].toUpperCase();
    const target = targetForRule(rawRule);
    if (type === "MATCH") {
      fallbackTarget = target;
      return;
    }
    if (type === "RULE-SET") {
      const provider = runtime.document.ruleProviders[parts[1]];
      const cache = runtime.caches[parts[1]];
      for (const rule of parseConfigRuleProvider(provider, cache.content)) {
        append({ ...rule, target });
      }
      return;
    }
    const parsedRule = parseRules(rawRule).rules[0];
    append({ type: parsedRule.type, value: parsedRule.value, target });
  });

  const proxies = new Map(runtime.document.proxies.map((proxy) => [
    proxy.name,
    { host: proxy.server, port: proxy.port },
  ]));
  const providerHosts = [...new Set([
    ...activeRuleProviders(runtime.document).map((provider) => new URL(provider.url).hostname.toLowerCase()),
    ...(runtime.sourceUrl ? [new URL(runtime.sourceUrl).hostname.toLowerCase()] : []),
  ])];
  return {
    rules,
    fallbackTarget,
    proxies,
    providerHosts,
  };
}

export async function getActiveConfigProxyState(nodeName?: string): Promise<{
  activeProxy: ConfigProxyNode;
} | undefined> {
  const runtime = await loadActiveConfigRuntime();
  if (!runtime) return undefined;
  const proxies: ConfigProxyNode[] = runtime.document.proxies.map((proxy) => ({
    name: proxy.name,
    host: proxy.server,
    port: proxy.port,
  }));
  const matchRule = runtime.document.rules.at(-1) ?? "";
  const matchTarget = targetForRule(matchRule);
  const activeProxy = nodeName
    ? proxies.find((proxy) => proxy.name === nodeName)
    : proxies.find((proxy) => proxy.name === matchTarget) ?? proxies[0];
  if (!activeProxy) throw new Error(`配置中不存在节点：${nodeName}`);
  return { activeProxy };
}
