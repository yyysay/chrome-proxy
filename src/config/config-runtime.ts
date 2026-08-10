import { parseRules } from "../rules/parser.ts";
import {
  CONFIG_DOCUMENT_ACTIVE_KEY,
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

const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;
export const CONFIG_PROVIDER_REFRESH_ALARM = "refresh-config-providers";

interface ConfigProviderCache {
  url: string;
  content: string;
  fetchedAt: string;
  lastAttemptAt: string;
  status: "ready" | "cached";
  error?: string;
}

type ConfigProviderCaches = Record<string, ConfigProviderCache>;

export interface ConfigDocumentState {
  active: boolean;
  yaml: string;
  sourceUrl: string;
  nodes: Array<{ name: string; host: string; port: number }>;
  providers: Record<string, {
    status: "missing" | "ready" | "cached";
    fetchedAt?: string;
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

async function updateProviders(
  document: MinimalConfigDocument,
  previous: ConfigProviderCaches,
): Promise<{ caches: ConfigProviderCaches; refreshed: number; cached: number }> {
  const entries = await Promise.all(Object.values(document.ruleProviders).map(async (provider) => {
    try {
      return [provider.name, await fetchProvider(provider), false] as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : "规则包下载失败";
      const cached = previous[provider.name];
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
      }, true] as const;
    }
  }));

  return {
    caches: Object.fromEntries(entries.map(([name, cache]) => [name, cache])),
    refreshed: entries.filter((entry) => !entry[2]).length,
    cached: entries.filter((entry) => entry[2]).length,
  };
}

async function readStoredDocument(): Promise<{
  active: boolean;
  yaml: string;
  sourceUrl: string;
  document?: MinimalConfigDocument;
}> {
  const stored = await chrome.storage.local.get([
    CONFIG_DOCUMENT_ACTIVE_KEY,
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
    document: validation.document,
  };
}

export async function getConfigDocumentState(): Promise<ConfigDocumentState> {
  const [stored, caches] = await Promise.all([readStoredDocument(), loadProviderCaches()]);
  const providers: ConfigDocumentState["providers"] = {};
  for (const provider of Object.values(stored.document?.ruleProviders ?? {})) {
    const cache = caches[provider.name];
    providers[provider.name] = cache?.url === provider.url
      ? { status: cache.status, fetchedAt: cache.fetchedAt, error: cache.error }
      : { status: "missing" };
  }
  return {
    active: stored.active,
    yaml: stored.yaml,
    sourceUrl: stored.sourceUrl,
    nodes: (stored.document?.proxies ?? []).map((node) => ({
      name: node.name,
      host: node.server,
      port: node.port,
    })),
    providers,
  };
}

export async function activateConfigDocument(yaml: string, sourceUrl = ""): Promise<{
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
  const previous = await loadProviderCaches();
  const updated = await updateProviders(validation.document, previous);
  await chrome.storage.local.set({
    [CONFIG_DOCUMENT_ACTIVE_KEY]: true,
    [CONFIG_DOCUMENT_URL_KEY]: normalizedSourceUrl,
    [CONFIG_DOCUMENT_YAML_KEY]: yaml,
    [CONFIG_PROVIDER_CACHE_KEY]: updated.caches,
  });
  await syncConfigProviderRefreshAlarm();
  return {
    state: await getConfigDocumentState(),
    refreshed: updated.refreshed,
    cached: updated.cached,
  };
}

export async function refreshConfigDocumentProviders(): Promise<{
  state: ConfigDocumentState;
  refreshed: number;
  cached: number;
}> {
  const stored = await readStoredDocument();
  if (!stored.active || !stored.document) throw new Error("尚未应用测试配置");
  const previous = await loadProviderCaches();
  const updated = await updateProviders(stored.document, previous);
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
  return getConfigDocumentState();
}

export async function syncConfigProviderRefreshAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  const stored = await readStoredDocument();
  const intervals = Object.values(stored.document?.ruleProviders ?? {})
    .map((provider) => provider.interval);
  if (!stored.active || intervals.length === 0) {
    await chrome.alarms.clear(CONFIG_PROVIDER_REFRESH_ALARM);
    return;
  }
  await chrome.alarms.create(CONFIG_PROVIDER_REFRESH_ALARM, {
    periodInMinutes: Math.max(1, Math.min(...intervals) / 60),
  });
}

export async function loadActiveConfigRuntime(): Promise<ActiveConfigRuntime | undefined> {
  const [stored, caches] = await Promise.all([readStoredDocument(), loadProviderCaches()]);
  if (!stored.active || !stored.document) return undefined;
  for (const provider of Object.values(stored.document.ruleProviders)) {
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
    ...Object.values(runtime.document.ruleProviders).map((provider) => new URL(provider.url).hostname.toLowerCase()),
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
