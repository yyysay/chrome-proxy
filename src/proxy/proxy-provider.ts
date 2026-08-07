export interface ProxyNode {
  id: string;
  name: string;
  type: "http";
  host: string;
  port: number;
}

export interface ProxySubscriptionDocument {
  version: 1;
  updatedAt?: string;
  proxies: ProxyNode[];
}

export type ProxySourceMode = "subscription" | "manual";
export type EffectiveProxySource = "subscription" | "manual" | "fallback";

export interface ProxySubscriptionCache {
  url: string;
  document: ProxySubscriptionDocument;
  fetchedAt: string;
  lastAttemptAt: string;
  status: "ready" | "cached";
  error?: string;
}

export interface ProxyProviderState {
  sourceMode: ProxySourceMode;
  effectiveSource: EffectiveProxySource;
  subscriptionUrl: string;
  activeProxy: ProxyNode;
  proxies: ProxyNode[];
  manualOverride?: ProxyNode;
  subscription?: ProxySubscriptionCache;
  subscriptionError?: string;
}

// 发布前在这里填入你的正式代理配置订阅地址。
export const DEFAULT_PROXY_SUBSCRIPTION_URL = "https://dufs.ms.y3-3am.top/autoproxy/proxies.json";

export const BUILTIN_FALLBACK_PROXY: ProxyNode = {
  id: "builtin-local",
  name: "Local Proxy",
  type: "http",
  host: "127.0.0.1",
  port: 7890,
};

export const PROXY_SOURCE_MODE_KEY = "proxySourceMode";
export const PROXY_SUBSCRIPTION_URL_KEY = "proxySubscriptionUrl";
export const PROXY_SUBSCRIPTION_CACHE_KEY = "proxySubscriptionCache";
export const PROXY_SUBSCRIPTION_ERROR_KEY = "proxySubscriptionError";
export const PROXY_MANUAL_OVERRIDE_KEY = "proxyManualOverride";
export const LEGACY_PROXY_CONFIG_KEY = "proxyConfig";
const LEGACY_PROXY_ACTIVE_ID_KEY = "activeProxyId";

const MAX_SUBSCRIPTION_BYTES = 256 * 1024;
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

function isValidHost(host: unknown): host is string {
  return typeof host === "string" &&
    host.trim().length > 0 &&
    !host.includes("://") &&
    !host.includes("/");
}

export function isValidProxyNode(value: unknown): value is ProxyNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<ProxyNode>;
  return typeof node.id === "string" && node.id.trim().length > 0 &&
    typeof node.name === "string" && node.name.trim().length > 0 &&
    node.type === "http" &&
    isValidHost(node.host) &&
    typeof node.port === "number" && Number.isInteger(node.port) &&
    node.port >= 1 && node.port <= 65535;
}

function normalizeNode(value: ProxyNode): ProxyNode {
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    type: "http",
    host: value.host.trim(),
    port: value.port,
  };
}

function parseSubscriptionDocument(value: unknown): ProxySubscriptionDocument {
  if (!value || typeof value !== "object") {
    throw new Error("代理订阅不是有效的 JSON 对象");
  }

  const document = value as Partial<ProxySubscriptionDocument>;
  if (document.version !== 1) {
    throw new Error("当前仅支持 version: 1 的代理订阅");
  }
  if (!Array.isArray(document.proxies) || document.proxies.length === 0) {
    throw new Error("代理订阅至少需要一个 proxies 节点");
  }

  const proxies = document.proxies.filter(isValidProxyNode).map(normalizeNode);
  if (proxies.length !== document.proxies.length) {
    throw new Error("代理订阅中存在无效节点");
  }

  const ids = new Set<string>();
  for (const node of proxies) {
    if (ids.has(node.id)) throw new Error(`代理节点 ID 重复：${node.id}`);
    ids.add(node.id);
  }

  return {
    version: 1,
    updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : undefined,
    proxies,
  };
}

function isSubscriptionCache(value: unknown): value is ProxySubscriptionCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<ProxySubscriptionCache>;
  if (typeof cache.url !== "string" || typeof cache.fetchedAt !== "string" ||
      typeof cache.lastAttemptAt !== "string" || !cache.document) return false;
  try {
    parseSubscriptionDocument(cache.document);
    return true;
  } catch {
    return false;
  }
}

async function loadRawState(): Promise<{
  sourceMode: ProxySourceMode;
  subscriptionUrl: string;
  manualOverride?: ProxyNode;
  subscription?: ProxySubscriptionCache;
  subscriptionError?: string;
}> {
  const stored = await chrome.storage.local.get([
    PROXY_SOURCE_MODE_KEY,
    PROXY_SUBSCRIPTION_URL_KEY,
    PROXY_MANUAL_OVERRIDE_KEY,
    PROXY_SUBSCRIPTION_CACHE_KEY,
    PROXY_SUBSCRIPTION_ERROR_KEY,
  ]);

  const subscriptionUrl = typeof stored[PROXY_SUBSCRIPTION_URL_KEY] === "string"
    ? stored[PROXY_SUBSCRIPTION_URL_KEY].trim()
    : DEFAULT_PROXY_SUBSCRIPTION_URL;
  const manualOverride = isValidProxyNode(stored[PROXY_MANUAL_OVERRIDE_KEY])
    ? normalizeNode(stored[PROXY_MANUAL_OVERRIDE_KEY])
    : undefined;
  const subscription = isSubscriptionCache(stored[PROXY_SUBSCRIPTION_CACHE_KEY])
    ? stored[PROXY_SUBSCRIPTION_CACHE_KEY]
    : undefined;

  return {
    sourceMode: stored[PROXY_SOURCE_MODE_KEY] === "manual" ? "manual" : "subscription",
    subscriptionUrl,
    manualOverride,
    subscription,
    subscriptionError: typeof stored[PROXY_SUBSCRIPTION_ERROR_KEY] === "string"
      ? stored[PROXY_SUBSCRIPTION_ERROR_KEY]
      : undefined,
  };
}

export async function getProxyProviderState(): Promise<ProxyProviderState> {
  const raw = await loadRawState();
  const cachedMatchesUrl = raw.subscription && raw.subscription.url === raw.subscriptionUrl;
  const proxies = cachedMatchesUrl ? raw.subscription!.document.proxies : [];
  // V14 不暴露多节点选择。协议仍保留 proxies[]，运行时固定使用第一个节点，
  // 为未来按规则选择出口保留 schema，而不把无意义的节点选择暴露给当前用户。
  const subscriptionProxy = proxies[0];

  if (raw.sourceMode === "manual" && raw.manualOverride) {
    return {
      ...raw,
      sourceMode: "manual",
      effectiveSource: "manual",
      activeProxy: raw.manualOverride,
      proxies,
    };
  }

  if (subscriptionProxy) {
    return {
      ...raw,
      sourceMode: raw.sourceMode,
      effectiveSource: "subscription",
      activeProxy: subscriptionProxy,
      proxies,
    };
  }

  return {
    ...raw,
    sourceMode: raw.sourceMode,
    effectiveSource: "fallback",
    activeProxy: BUILTIN_FALLBACK_PROXY,
    proxies,
  };
}

export async function getEffectiveProxy(): Promise<ProxyNode> {
  return (await getProxyProviderState()).activeProxy;
}

export async function setProxySourceMode(mode: ProxySourceMode): Promise<ProxyProviderState> {
  await chrome.storage.local.set({ [PROXY_SOURCE_MODE_KEY]: mode });
  return getProxyProviderState();
}

export async function saveManualProxy(host: string, port: number): Promise<ProxyProviderState> {
  const node: ProxyNode = {
    id: "manual",
    name: "Manual Proxy",
    type: "http",
    host: host.trim(),
    port,
  };
  if (!isValidProxyNode(node)) throw new Error("手动代理地址或端口无效");
  await chrome.storage.local.set({ [PROXY_MANUAL_OVERRIDE_KEY]: node });
  return getProxyProviderState();
}

export async function saveProxySubscriptionUrl(url: string): Promise<ProxyProviderState> {
  const normalized = url.trim();
  if (normalized) {
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new Error("代理订阅地址无效");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("代理订阅仅支持 HTTP/HTTPS");
    }
  }

  const raw = await loadRawState();
  if (raw.subscriptionUrl === normalized) return getProxyProviderState();

  await chrome.storage.local.set({ [PROXY_SUBSCRIPTION_URL_KEY]: normalized });
  await chrome.storage.local.remove([
    LEGACY_PROXY_ACTIVE_ID_KEY,
    PROXY_SUBSCRIPTION_ERROR_KEY,
  ]);
  return getProxyProviderState();
}

export interface RefreshProxySubscriptionResult {
  state: ProxyProviderState;
  endpointChanged: boolean;
  usedCached: boolean;
}

export async function refreshProxySubscription(): Promise<RefreshProxySubscriptionResult> {
  const before = await getProxyProviderState();
  const raw = await loadRawState();
  const url = raw.subscriptionUrl;

  if (!url) {
    throw new Error("尚未配置代理订阅地址");
  }

  const lastAttemptAt = new Date().toISOString();

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SUBSCRIPTION_BYTES) {
      throw new Error("代理订阅超过 256 KB 限制");
    }

    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_SUBSCRIPTION_BYTES) {
      throw new Error("代理订阅超过 256 KB 限制");
    }

    const document = parseSubscriptionDocument(JSON.parse(text) as unknown);
    const cache: ProxySubscriptionCache = {
      url,
      document,
      fetchedAt: new Date().toISOString(),
      lastAttemptAt,
      status: "ready",
    };

    await chrome.storage.local.set({ [PROXY_SUBSCRIPTION_CACHE_KEY]: cache });
    await chrome.storage.local.remove([
      PROXY_SUBSCRIPTION_ERROR_KEY,
      LEGACY_PROXY_ACTIVE_ID_KEY,
    ]);

    const state = await getProxyProviderState();
    return {
      state,
      endpointChanged: before.activeProxy.host !== state.activeProxy.host ||
        before.activeProxy.port !== state.activeProxy.port,
      usedCached: false,
    };
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "代理订阅 JSON 格式无效"
      : error instanceof Error ? error.message : "代理订阅更新失败";
    await chrome.storage.local.set({ [PROXY_SUBSCRIPTION_ERROR_KEY]: message });

    const hasLastKnownGood = raw.subscription?.url === url && raw.subscription.document.proxies.length > 0;
    if (hasLastKnownGood) {
      const cached: ProxySubscriptionCache = {
        ...raw.subscription!,
        lastAttemptAt,
        status: "cached",
        error: message,
      };
      await chrome.storage.local.set({ [PROXY_SUBSCRIPTION_CACHE_KEY]: cached });
      const state = await getProxyProviderState();
      return {
        state,
        endpointChanged: before.activeProxy.host !== state.activeProxy.host ||
          before.activeProxy.port !== state.activeProxy.port,
        usedCached: true,
      };
    }

    throw new Error(`代理订阅更新失败：${message}`);
  }
}

export async function migrateLegacyProxyConfig(): Promise<void> {
  const stored = await chrome.storage.local.get([
    LEGACY_PROXY_CONFIG_KEY,
    PROXY_MANUAL_OVERRIDE_KEY,
    PROXY_SOURCE_MODE_KEY,
    PROXY_SUBSCRIPTION_URL_KEY,
  ]);
  await chrome.storage.local.remove(LEGACY_PROXY_ACTIVE_ID_KEY);
  if (isValidProxyNode(stored[PROXY_MANUAL_OVERRIDE_KEY])) return;

  const legacy = stored[LEGACY_PROXY_CONFIG_KEY] as Partial<ProxyNode> | undefined;
  if (!legacy || legacy.type !== "http" || !isValidHost(legacy.host) ||
      typeof legacy.port !== "number" || !Number.isInteger(legacy.port) ||
      legacy.port < 1 || legacy.port > 65535) return;

  const manual: ProxyNode = {
    id: "manual",
    name: "Manual Proxy",
    type: "http",
    host: legacy.host.trim(),
    port: legacy.port,
  };
  const differsFromFallback = manual.host !== BUILTIN_FALLBACK_PROXY.host ||
    manual.port !== BUILTIN_FALLBACK_PROXY.port;

  const patch: Record<string, unknown> = {
    [PROXY_MANUAL_OVERRIDE_KEY]: manual,
  };
  if (stored[PROXY_SOURCE_MODE_KEY] === undefined && differsFromFallback &&
      !stored[PROXY_SUBSCRIPTION_URL_KEY]) {
    patch[PROXY_SOURCE_MODE_KEY] = "manual";
  }
  await chrome.storage.local.set(patch);
}
