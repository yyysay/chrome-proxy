import {
  DEFAULT_ENABLED_RULE_PACK_IDS,
  DEFAULT_RULE_PACKS,
  MANAGED_RULE_PACK_IDS,
} from "../rule-packs/catalog";
import { compileRulePacks } from "../rule-packs/compiler";
import { analyzeProviderRules } from "../rule-packs/provider-parser";
import type {
  RulePackDefinition,
  RulePackSourceState,
  RuleSourceStrategy,
} from "../rule-packs/types";
import { buildPacScript, ruleMatchesHostname } from "./pac-builder";
import {
  BUILTIN_FALLBACK_PROXY,
  DEFAULT_PROXY_SUBSCRIPTION_URL,
  PROXY_SOURCE_MODE_KEY,
  PROXY_SUBSCRIPTION_URL_KEY,
  getEffectiveProxy,
  getProxyProviderState,
  migrateLegacyProxyConfig,
  refreshProxySubscription as refreshProxyProviderSubscription,
  saveManualProxy,
  saveProxySubscriptionUrl,
  setProxySourceMode,
  type EffectiveProxySource,
  type ProxyNode,
  type ProxyProviderState,
  type ProxySourceMode,
} from "./proxy-provider";

const PROXY_STATE_KEY = "proxyState";
const PROXY_EVENT_KEY = "lastProxyEvent";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const LAST_PROXY_ERROR_KEY = "lastProxyError";
const RULE_PACK_SOURCES_KEY = "rulePackSources";
const RULE_PACK_DEFINITIONS_KEY = "rulePackDefinitions";
const MANAGED_RULE_OVERRIDES_KEY = "managedRuleOverrides";
const RULE_ENGINE_STATUS_KEY = "ruleEngineStatus";
const LEGACY_RULE_SOURCE_STRATEGIES_KEY = "ruleSourceStrategies";
const NETWORK_INFO_CACHE_KEY = "networkInfoCache";
const SIMPLE_ENABLED_RULE_PACK_IDS_KEY = "simpleEnabledRulePackIds";
const UI_MODE_KEY = "uiMode";
const FALLBACK_MODE_KEY = "fallbackMode";
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_RULES = 20_000;
const MAX_PAC_BYTES = 1_500_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type FallbackMode = "direct" | "proxy" | "system";

export interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface StoredProxyState {
  desiredEnabled: boolean;
  updatedAt: string;
}

interface ProxyEvent {
  type: "enabled" | "disabled" | "restored" | "lost";
  reason: string;
  occurredAt: string;
  observedMode?: string;
  levelOfControl?: string;
}

export interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
  mode?: string;
  levelOfControl: string;
  proxyEndpoint: string;
  proxyHost: string;
  proxyPort: number;
  proxyName: string;
  proxyNodeId: string;
  proxySource: EffectiveProxySource;
  fallbackMode: FallbackMode;
  lastEvent?: ProxyEvent;
  lastProxyError?: {
    error: string;
    details: string;
    fatal: boolean;
    occurredAt: string;
  };
  ruleEngineStatus?: {
    statistics: {
      parsed: number;
      effective: number;
      duplicates: number;
      conflicts: number;
      issues: number;
    };
    pacBytes: number;
    generatedAt: string;
  };
}

type RulePackSources = Record<string, RulePackSourceState>;
type ManagedRuleOverride = Partial<Pick<RulePackDefinition, "name" | "defaultUrl" | "defaultAction">>;
type ManagedRuleOverrides = Record<string, ManagedRuleOverride>;

function toProxyConfig(node: ProxyNode): ProxyConfig {
  return { type: "http", host: node.host, port: node.port };
}

function proxyEndpoint(node: ProxyNode): string {
  return `http://${node.host}:${node.port}`;
}

async function getDesiredEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROXY_STATE_KEY);
  const state = stored[PROXY_STATE_KEY] as StoredProxyState | undefined;
  return state?.desiredEnabled === true;
}

async function setDesiredEnabled(desiredEnabled: boolean): Promise<void> {
  const state: StoredProxyState = {
    desiredEnabled,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [PROXY_STATE_KEY]: state });
}

async function loadFallbackMode(): Promise<FallbackMode> {
  const stored = await chrome.storage.local.get(FALLBACK_MODE_KEY);
  const value = stored[FALLBACK_MODE_KEY] as unknown;
  return value === "proxy" || value === "system" ? value : "direct";
}

async function recordProxyEvent(event: Omit<ProxyEvent, "occurredAt">): Promise<void> {
  await chrome.storage.local.set({
    [PROXY_EVENT_KEY]: {
      ...event,
      occurredAt: new Date().toISOString(),
    } satisfies ProxyEvent,
  });
}

function managedRuleIds(): string[] {
  return [...MANAGED_RULE_PACK_IDS];
}

function managedRuleSourceHosts(definitions: readonly RulePackDefinition[]): string[] {
  const hosts = new Set<string>();
  for (const pack of definitions) {
    if (!isManagedDefinition(pack) || !pack.defaultUrl) continue;
    try {
      hosts.add(new URL(pack.defaultUrl).hostname.toLowerCase());
    } catch {
      // 高级设置里允许覆盖默认规则 URL；无效 URL 会在保存/刷新时给出明确错误。
    }
  }
  return [...hosts];
}

async function loadEnabledCustomRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(ENABLED_RULE_PACK_IDS_KEY);
  const value = stored[ENABLED_RULE_PACK_IDS_KEY] as unknown;
  if (!Array.isArray(value)) return [];
  const managed = new Set(MANAGED_RULE_PACK_IDS);
  return value.filter((id): id is string => typeof id === "string" && !managed.has(id));
}

async function loadActiveEnabledRulePackIds(): Promise<string[]> {
  const custom = await loadEnabledCustomRulePackIds();
  return [...custom, ...managedRuleIds()];
}

function isManagedDefinition(pack: RulePackDefinition): boolean {
  return MANAGED_RULE_PACK_IDS.includes(pack.id);
}

function isManagedDuplicate(pack: RulePackDefinition): boolean {
  return DEFAULT_RULE_PACKS.some((managed) =>
    pack.id === managed.id ||
    (Boolean(pack.defaultUrl) && pack.defaultUrl === managed.defaultUrl && pack.name === managed.name));
}

async function loadCustomRulePackDefinitions(): Promise<RulePackDefinition[]> {
  const stored = await chrome.storage.local.get(RULE_PACK_DEFINITIONS_KEY);
  const value = stored[RULE_PACK_DEFINITIONS_KEY] as unknown;
  if (!Array.isArray(value)) return [];
  return (value as RulePackDefinition[])
    .filter((pack) => pack && typeof pack.id === "string" && !isManagedDuplicate(pack))
    .map((pack) => ({ ...pack, kind: "custom" as const }));
}

async function loadManagedRuleOverrides(): Promise<ManagedRuleOverrides> {
  const stored = await chrome.storage.local.get(MANAGED_RULE_OVERRIDES_KEY);
  const value = stored[MANAGED_RULE_OVERRIDES_KEY] as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ManagedRuleOverrides;
}

async function saveManagedRuleOverrides(overrides: ManagedRuleOverrides): Promise<void> {
  await chrome.storage.local.set({ [MANAGED_RULE_OVERRIDES_KEY]: overrides });
}

async function loadRulePackDefinitions(): Promise<RulePackDefinition[]> {
  const [custom, overrides] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadManagedRuleOverrides(),
  ]);
  const managed = DEFAULT_RULE_PACKS.map((pack) => ({
    ...pack,
    ...(overrides[pack.id] ?? {}),
    kind: "managed" as const,
  }));
  // 自定义规则在前，compiler 的 first-rule-wins 因此自然实现 Custom > Managed。
  return [...custom, ...managed];
}

async function saveCustomRulePackDefinitions(definitions: readonly RulePackDefinition[]): Promise<void> {
  await chrome.storage.local.set({
    [RULE_PACK_DEFINITIONS_KEY]: definitions.filter((pack) => !isManagedDefinition(pack)),
  });
}

async function loadRulePackSources(): Promise<RulePackSources> {
  const stored = await chrome.storage.local.get(RULE_PACK_SOURCES_KEY);
  const value = stored[RULE_PACK_SOURCES_KEY] as unknown;
  return value && typeof value === "object" ? value as RulePackSources : {};
}

async function saveRulePackSources(sources: RulePackSources): Promise<void> {
  await chrome.storage.local.set({ [RULE_PACK_SOURCES_KEY]: sources });
}

function normalizeRuleSourceStrategy(value: unknown): RuleSourceStrategy {
  return value === "local-first" || value === "subscription-first" || value === "merge"
    ? value
    : "merge";
}

function buildRulePackContent(
  pack: RulePackDefinition,
  source: RulePackSourceState | undefined,
): { rulesText: string; ignored: number; sourceStrategy: RuleSourceStrategy } {
  const sourceStrategy = normalizeRuleSourceStrategy(source?.sourceStrategy);
  const localContent = source?.customContent?.trim() ?? "";
  const subscriptionContent = source?.cachedContent?.trim() || pack.rulesText?.trim() || "";
  let selectedContents: string[];

  if (sourceStrategy === "local-first") {
    selectedContents = localContent ? [localContent] : subscriptionContent ? [subscriptionContent] : [];
  } else if (sourceStrategy === "subscription-first") {
    selectedContents = subscriptionContent ? [subscriptionContent] : localContent ? [localContent] : [];
  } else {
    selectedContents = [localContent, subscriptionContent].filter(Boolean);
  }

  const seen = new Set<string>();
  const normalizedLines: string[] = [];
  let ignored = 0;

  for (const content of selectedContents) {
    const analyzed = analyzeProviderRules(content, pack.defaultAction);
    ignored += analyzed.ignored;
    for (const line of analyzed.rulesText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalizedLines.push(trimmed);
    }
  }

  return { rulesText: normalizedLines.join("\n"), ignored, sourceStrategy };
}

let proxySettingsMutationQueue: Promise<void> = Promise.resolve();

export function runExclusiveProxyMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = proxySettingsMutationQueue.then(task, task);
  proxySettingsMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function downloadRuleSourceText(pack: RulePackDefinition, url: string): Promise<string> {
  const download = async (): Promise<string> => {
    let temporaryProxyApplied = false;

    if (isManagedDefinition(pack)) {
      const [desiredEnabled, fallbackMode, effective] = await Promise.all([
        getDesiredEnabled(),
        loadFallbackMode(),
        readEffectiveSetting(),
      ]);
      const regularPacCanRouteSource = desiredEnabled && fallbackMode !== "system" &&
        effective.mode === "pac_script" && effective.levelOfControl === "controlled_by_this_extension";

      if (!regularPacCanRouteSource) {
        const parsed = new URL(url);
        const config = toProxyConfig(await getEffectiveProxy());
        assertControllable(effective.levelOfControl);
        const host = JSON.stringify(parsed.hostname.toLowerCase());
        const suffix = JSON.stringify(`.${parsed.hostname.toLowerCase()}`);
        const proxyResult = JSON.stringify(`PROXY ${config.host}:${config.port}`);
        const temporaryPac: chrome.proxy.ProxyConfig = {
          mode: "pac_script",
          pacScript: {
            mandatory: true,
            data: [
              "function FindProxyForURL(url, host) {",
              "  host = host.toLowerCase();",
              `  if (host === ${host} || dnsDomainIs(host, ${suffix})) return ${proxyResult};`,
              '  return "DIRECT";',
              "}",
            ].join("\n"),
          },
        };
        await chrome.proxy.settings.set({ value: temporaryPac, scope: "regular" });
        temporaryProxyApplied = true;
      }
    }

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new Error("订阅文件超过 2 MB 限制");
      }
      const content = await response.text();
      if (new TextEncoder().encode(content).byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error("订阅文件超过 2 MB 限制");
      }
      return content;
    } finally {
      if (temporaryProxyApplied) {
        if (await getDesiredEnabled()) await applySelectedMode();
        else await chrome.proxy.settings.clear({ scope: "regular" });
      }
    }
  };

  return isManagedDefinition(pack)
    ? runExclusiveProxyMutation(download)
    : download();
}

async function refreshRulePackSource(packId: string): Promise<void> {
  const definitions = await loadRulePackDefinitions();
  const pack = definitions.find((item) => item.id === packId);
  if (!pack) throw new Error(`未知规则：${packId}`);

  const sources = await loadRulePackSources();
  const current = sources[packId] ?? {};
  const url = current.url || pack.defaultUrl;
  const lastAttemptAt = new Date().toISOString();
  if (!url) throw new Error(`${pack.name} 没有远程订阅地址`);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${pack.name} 的订阅地址无效`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`${pack.name} 仅支持 HTTP/HTTPS 订阅`);
  }

  sources[packId] = {
    ...current,
    url,
    lastAttemptAt,
    status: "downloading",
    error: undefined,
  };
  await saveRulePackSources(sources);

  try {
    // Managed Rules 属于产品基础设施：无论规则本身是否已经命中其下载域名，
    // 下载请求都强制经过当前有效代理。自定义规则订阅仍按用户当前网络策略请求。
    const content = await downloadRuleSourceText(pack, url);

    sources[packId] = {
      ...current,
      url,
      cachedContent: content,
      updatedAt: new Date().toISOString(),
      lastAttemptAt,
      status: "ready",
      error: undefined,
    };
    await saveRulePackSources(sources);
  } catch (error) {
    sources[packId] = {
      ...current,
      url,
      lastAttemptAt,
      status: current.customContent || current.cachedContent || pack.rulesText ? "cached" : "error",
      error: error instanceof Error ? error.message : "下载失败",
    };
    await saveRulePackSources(sources);
    if (!current.customContent && !current.cachedContent && !pack.rulesText) {
      throw new Error(`${pack.name} 规则下载失败：${sources[packId].error}`);
    }
  }
}

async function loadRuntimeCatalog(): Promise<RulePackDefinition[]> {
  const [sources, definitions] = await Promise.all([
    loadRulePackSources(),
    loadRulePackDefinitions(),
  ]);
  return definitions.map((pack) => {
    const runtime = buildRulePackContent(pack, sources[pack.id]);
    return { ...pack, rulesText: runtime.rulesText };
  });
}

async function createPacConfig(config: ProxyConfig): Promise<{
  config: chrome.proxy.ProxyConfig;
  report: {
    statistics: ReturnType<typeof compileRulePacks>["statistics"];
    conflicts: ReturnType<typeof compileRulePacks>["conflicts"];
    pacBytes: number;
    generatedAt: string;
  };
}> {
  const [enabledPackIds, fallbackMode, runtimeCatalog] = await Promise.all([
    loadActiveEnabledRulePackIds(),
    loadFallbackMode(),
    loadRuntimeCatalog(),
  ]);
  const compiled = compileRulePacks(runtimeCatalog, enabledPackIds);
  if (compiled.rules.length > MAX_RULES) {
    throw new Error(`有效规则数量 ${compiled.rules.length} 超过 ${MAX_RULES} 条限制`);
  }

  // 未命中策略由高级设置决定；system 模式不生成 PAC，由 applySelectedMode 直接交还系统代理。
  const pac = buildPacScript(
    compiled.rules,
    config,
    fallbackMode === "proxy" ? "PROXY" : "DIRECT",
    managedRuleSourceHosts(runtimeCatalog),
  );
  const pacBytes = new TextEncoder().encode(pac.script).byteLength;
  if (pacBytes > MAX_PAC_BYTES) {
    throw new Error(`PAC 大小 ${pacBytes} 字节超过 ${MAX_PAC_BYTES} 字节限制`);
  }

  return {
    config: {
      mode: "pac_script",
      pacScript: { data: pac.script, mandatory: true },
    },
    report: {
      statistics: compiled.statistics,
      conflicts: compiled.conflicts,
      pacBytes,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function readEffectiveSetting(): Promise<{ mode?: string; levelOfControl: string }> {
  const result = await chrome.proxy.settings.get({ incognito: false });
  const value = result.value as chrome.proxy.ProxyConfig | undefined;
  return { mode: value?.mode, levelOfControl: result.levelOfControl };
}

function assertControllable(levelOfControl: string): void {
  if (levelOfControl !== "controllable_by_this_extension" &&
      levelOfControl !== "controlled_by_this_extension") {
    throw new Error(`当前代理设置不可由本扩展控制：${levelOfControl}`);
  }
}

async function applyPac(config: ProxyConfig): Promise<void> {
  const previous = await chrome.proxy.settings.get({ incognito: false });
  const before = {
    mode: (previous.value as chrome.proxy.ProxyConfig | undefined)?.mode,
    levelOfControl: previous.levelOfControl,
  };
  assertControllable(before.levelOfControl);
  const generated = await createPacConfig(config);

  try {
    await chrome.proxy.settings.set({ value: generated.config, scope: "regular" });
    const after = await readEffectiveSetting();
    if (after.mode !== "pac_script" || after.levelOfControl !== "controlled_by_this_extension") {
      throw new Error(`PAC 写入后未生效：${after.mode ?? "unknown"} / ${after.levelOfControl}`);
    }
    await chrome.storage.local.set({ [RULE_ENGINE_STATUS_KEY]: generated.report });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  } catch (error) {
    if (previous.levelOfControl === "controlled_by_this_extension") {
      await chrome.proxy.settings.set({
        value: previous.value as chrome.proxy.ProxyConfig,
        scope: "regular",
      });
    } else {
      await chrome.proxy.settings.clear({ scope: "regular" });
    }
    throw error;
  }
}

async function applySelectedMode(): Promise<void> {
  const fallbackMode = await loadFallbackMode();
  if (fallbackMode === "system") {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return;
  }
  await applyPac(toProxyConfig(await getEffectiveProxy()));
}

async function maybeBootstrapProxySubscription(): Promise<void> {
  const state = await getProxyProviderState();
  if (state.sourceMode !== "subscription" || !state.subscriptionUrl ||
      state.effectiveSource === "subscription") return;
  await refreshProxyProviderSubscription().catch(() => undefined);
}

export async function enableProxy(): Promise<ProxyConfig> {
  await maybeBootstrapProxySubscription();
  const config = toProxyConfig(await getEffectiveProxy());
  await setDesiredEnabled(true);
  try {
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    await applySelectedMode();
    const fallbackMode = await loadFallbackMode();
    await recordProxyEvent({
      type: "enabled",
      reason: "user",
      observedMode: fallbackMode === "system" ? "system" : "pac_script",
      levelOfControl: fallbackMode === "system" ? "system" : "controlled_by_this_extension",
    });
  } catch (error) {
    await setDesiredEnabled(false);
    throw error;
  }
  return config;
}

export async function disableProxy(): Promise<void> {
  await setDesiredEnabled(false);
  await chrome.proxy.settings.clear({ scope: "regular" });
  await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  await recordProxyEvent({ type: "disabled", reason: "user" });
}

export async function reconcileProxy(reason: string, forceApply = false): Promise<boolean> {
  if (!(await getDesiredEnabled())) return false;
  const [current, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    loadFallbackMode(),
  ]);

  if (fallbackMode === "system") {
    if (!forceApply && current.mode === "system") return false;
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return true;
  }

  if (!forceApply && current.mode === "pac_script" &&
      current.levelOfControl === "controlled_by_this_extension") return false;

  await recordProxyEvent({
    type: "lost",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });
  await applySelectedMode();
  await recordProxyEvent({
    type: "restored",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });
  return true;
}

async function invalidateNetworkCacheIfEndpointChanged(
  before: ProxyProviderState,
  after: ProxyProviderState,
): Promise<boolean> {
  const changed = before.activeProxy.host !== after.activeProxy.host ||
    before.activeProxy.port !== after.activeProxy.port;
  if (changed) await chrome.storage.local.remove(NETWORK_INFO_CACHE_KEY);
  return changed;
}

export async function getProxyProviderSettings(): Promise<ProxyProviderState> {
  return getProxyProviderState();
}

export async function updateProxySourceMode(mode: ProxySourceMode): Promise<{
  state: ProxyProviderState;
  pacReapplied: boolean;
}> {
  const before = await getProxyProviderState();
  if (mode === "manual" && !before.manualOverride) {
    throw new Error("请先保存手动代理地址");
  }
  const state = await setProxySourceMode(mode);
  const changed = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = await reconcileProxy("proxySource.updated", changed || before.effectiveSource !== state.effectiveSource);
  return { state, pacReapplied };
}

export async function saveManualProxyConfig(host: string, port: number): Promise<{
  state: ProxyProviderState;
  pacReapplied: boolean;
}> {
  const before = await getProxyProviderState();
  await saveManualProxy(host, port);
  // 第一次保存手动地址就同时启用手动覆盖，避免“先切模式但没有地址”的死锁。
  const state = await setProxySourceMode("manual");
  const changed = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = await reconcileProxy("manualProxy.updated", changed || before.effectiveSource !== state.effectiveSource);
  return { state, pacReapplied };
}

export async function updateProxySubscriptionUrl(url: string): Promise<{
  state: ProxyProviderState;
  endpointChanged: boolean;
  usedCached: boolean;
  pacReapplied: boolean;
  updateFailed?: string;
}> {
  const before = await getProxyProviderState();
  let state = await saveProxySubscriptionUrl(url);
  let usedCached = false;
  let updateFailed: string | undefined;

  if (url.trim()) {
    try {
      const refreshed = await refreshProxyProviderSubscription();
      state = refreshed.state;
      usedCached = refreshed.usedCached;
    } catch (error) {
      updateFailed = error instanceof Error ? error.message : "代理订阅更新失败";
      state = await getProxyProviderState();
    }
  }

  const endpointChanged = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = state.sourceMode === "subscription"
    ? await reconcileProxy("proxySubscription.updated", true)
    : false;
  return { state, endpointChanged, usedCached, pacReapplied, updateFailed };
}

export async function refreshProxySubscription(): Promise<{
  state: ProxyProviderState;
  endpointChanged: boolean;
  usedCached: boolean;
  pacReapplied: boolean;
  updateFailed?: string;
}> {
  const before = await getProxyProviderState();
  let state: ProxyProviderState;
  let usedCached = false;
  let updateFailed: string | undefined;

  try {
    const refreshed = await refreshProxyProviderSubscription();
    state = refreshed.state;
    usedCached = refreshed.usedCached;
  } catch (error) {
    updateFailed = error instanceof Error ? error.message : "代理订阅更新失败";
    state = await getProxyProviderState();
  }

  const endpointChanged = await invalidateNetworkCacheIfEndpointChanged(before, state);
  const pacReapplied = state.sourceMode === "subscription" && endpointChanged
    ? await reconcileProxy("proxySubscription.refreshed", true)
    : false;
  return { state, endpointChanged, usedCached, pacReapplied, updateFailed };
}

export async function updateEnabledRulePacks(requestedIds: readonly string[]): Promise<{
  enabledPackIds: string[];
  pacReapplied: boolean;
}> {
  const customDefinitions = await loadCustomRulePackDefinitions();
  const customIds = new Set(customDefinitions.map((pack) => pack.id));
  const enabledPackIds = requestedIds.filter((id) => customIds.has(id));
  const [previousEnabledIds, sources] = await Promise.all([
    loadEnabledCustomRulePackIds(),
    loadRulePackSources(),
  ]);

  const definitionById = new Map(customDefinitions.map((pack) => [pack.id, pack]));
  const remoteIds = enabledPackIds.filter((id) => {
    const pack = definitionById.get(id);
    if (!pack) return false;
    const source = sources[id];
    return Boolean(source?.url || pack.defaultUrl) && !source?.cachedContent;
  });
  await Promise.all(remoteIds.map(refreshRulePackSource));
  await chrome.storage.local.set({ [ENABLED_RULE_PACK_IDS_KEY]: enabledPackIds });

  try {
    const pacReapplied = await reconcileProxy("customRulePacks.updated", true);
    return { enabledPackIds, pacReapplied };
  } catch (error) {
    await chrome.storage.local.set({ [ENABLED_RULE_PACK_IDS_KEY]: previousEnabledIds });
    throw error;
  }
}

export async function getRulePackSettings() {
  const [sources, enabledCustomIds, definitions, managedOverrides] = await Promise.all([
    loadRulePackSources(),
    loadEnabledCustomRulePackIds(),
    loadRulePackDefinitions(),
    loadManagedRuleOverrides(),
  ]);

  return definitions.map((pack) => {
    const source = sources[pack.id] ?? {};
    const runtime = buildRulePackContent(pack, source);
    const runtimePack = { ...pack, rulesText: runtime.rulesText };
    const validation = compileRulePacks([runtimePack], [pack.id]).statistics;
    const managed = isManagedDefinition(pack);
    const baseManaged = managed ? DEFAULT_RULE_PACKS.find((item) => item.id === pack.id) : undefined;
    const customized = managed && Boolean(
      managedOverrides[pack.id] ||
      source.customContent?.trim() ||
      (source.sourceStrategy && source.sourceStrategy !== "merge") ||
      (baseManaged && source.url && source.url !== baseManaged.defaultUrl)
    );
    return {
      ...pack,
      managed,
      customized,
      enabled: managed || enabledCustomIds.includes(pack.id),
      sourceStrategy: runtime.sourceStrategy,
      source: { ...source, sourceStrategy: runtime.sourceStrategy },
      validation: {
        effective: validation.effective,
        ignored: runtime.ignored + validation.issues,
      },
    };
  });
}

export async function testRuleMatch(input: string): Promise<{
  hostname: string;
  action: "DIRECT" | "PROXY" | "SYSTEM";
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

  const compiled = compileRulePacks(
    await loadRuntimeCatalog(),
    await loadActiveEnabledRulePackIds(),
  );
  const matchedRule = compiled.rules.find((rule) => ruleMatchesHostname(rule, hostname));
  if (matchedRule) {
    return {
      hostname,
      action: matchedRule.action === "DIRECT" ? "DIRECT" : "PROXY",
      matched: true,
      rule: { type: matchedRule.type, value: matchedRule.value },
    };
  }
  const fallbackMode = await loadFallbackMode();
  return {
    hostname,
    action: fallbackMode === "proxy" ? "PROXY" : fallbackMode === "system" ? "SYSTEM" : "DIRECT",
    matched: false,
  };
}

export async function saveRulePack(
  packId: string | undefined,
  name: string,
  url: string,
  action: "DIRECT" | "PROXY",
  customContent: string,
  sourceStrategy: RuleSourceStrategy = "merge",
): Promise<string> {
  if (!name.trim()) throw new Error("规则名称不能为空");

  const normalizedStrategy = normalizeRuleSourceStrategy(sourceStrategy);
  const normalizedUrl = url.trim();
  const normalizedCustomContent = customContent.trim();
  if (!normalizedUrl && !normalizedCustomContent) {
    throw new Error("订阅地址和本地规则内容至少填写一项");
  }

  if (packId && MANAGED_RULE_PACK_IDS.includes(packId)) {
    const base = DEFAULT_RULE_PACKS.find((item) => item.id === packId);
    if (!base) throw new Error("默认规则不存在");

    const [previousOverrides, previousSources] = await Promise.all([
      loadManagedRuleOverrides(),
      loadRulePackSources(),
    ]);
    const overrides = { ...previousOverrides };
    const override: ManagedRuleOverride = {};
    const normalizedName = name.trim();
    if (normalizedName !== base.name) override.name = normalizedName;
    if (normalizedUrl !== base.defaultUrl) override.defaultUrl = normalizedUrl;
    if (action !== base.defaultAction) override.defaultAction = action;
    if (Object.keys(override).length > 0) overrides[packId] = override;
    else delete overrides[packId];

    const sources = { ...previousSources };
    const previousSource = sources[packId] ?? {};
    const previousUrl = previousSource.url || base.defaultUrl;
    const remoteSourceChanged = previousUrl !== normalizedUrl;
    sources[packId] = {
      ...previousSource,
      sourceStrategy: normalizedStrategy,
      url: normalizedUrl,
      customContent: normalizedCustomContent || undefined,
      cachedContent: remoteSourceChanged ? undefined : previousSource.cachedContent,
      updatedAt: remoteSourceChanged ? undefined : previousSource.updatedAt,
      modifiedAt: new Date().toISOString(),
      error: undefined,
    };

    await Promise.all([
      saveManagedRuleOverrides(overrides),
      saveRulePackSources(sources),
    ]);

    try {
      if (normalizedUrl && (remoteSourceChanged || !sources[packId].cachedContent)) {
        await refreshRulePackSource(packId);
      }
      await reconcileProxy("managedRulePack.updated", true);
    } catch (error) {
      await Promise.all([
        saveManagedRuleOverrides(previousOverrides),
        saveRulePackSources(previousSources),
      ]);
      throw error;
    }
    return packId;
  }

  const [definitions, previousSources] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const previousDefinitions = definitions.map((item) => ({ ...item }));
  const id = packId || crypto.randomUUID();
  const existingIndex = definitions.findIndex((item) => item.id === id);
  const definition: RulePackDefinition = {
    id,
    name: name.trim(),
    description: "自定义规则",
    enabledByDefault: false,
    defaultUrl: normalizedUrl,
    defaultAction: action,
    kind: "custom",
  };
  if (existingIndex >= 0) definitions[existingIndex] = definition;
  else definitions.push(definition);
  await saveCustomRulePackDefinitions(definitions);

  const sources = { ...previousSources };
  const previousSource = sources[id] ?? {};
  const previousDefinition = existingIndex >= 0 ? previousDefinitions[existingIndex] : undefined;
  const previousUrl = previousSource.url || previousDefinition?.defaultUrl || "";
  const remoteSourceChanged = previousUrl !== normalizedUrl;
  sources[id] = {
    ...previousSource,
    sourceStrategy: normalizedStrategy,
    url: normalizedUrl,
    customContent: normalizedCustomContent || undefined,
    cachedContent: remoteSourceChanged || !normalizedUrl ? undefined : previousSource.cachedContent,
    updatedAt: remoteSourceChanged || !normalizedUrl ? undefined : previousSource.updatedAt,
    modifiedAt: new Date().toISOString(),
    error: undefined,
  };
  await saveRulePackSources(sources);

  try {
    if (normalizedUrl && (remoteSourceChanged || !sources[id].cachedContent)) {
      await refreshRulePackSource(id);
    }
    await reconcileProxy("customRulePack.updated", true);
  } catch (error) {
    await Promise.all([
      saveCustomRulePackDefinitions(previousDefinitions),
      saveRulePackSources(previousSources),
    ]);
    throw error;
  }
  return id;
}

export async function refreshEnabledRulePacks(): Promise<{
  refreshed: number;
  cached: number;
  skipped: number;
}> {
  const [enabledCustomIds, definitions, sources] = await Promise.all([
    loadEnabledCustomRulePackIds(),
    loadRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const enabledIds = new Set([...enabledCustomIds, ...MANAGED_RULE_PACK_IDS]);
  let refreshed = 0;
  let cached = 0;
  let skipped = 0;

  for (const pack of definitions) {
    if (!enabledIds.has(pack.id)) continue;
    const before = sources[pack.id];
    const url = before?.url || pack.defaultUrl;
    if (!url) {
      skipped += 1;
      continue;
    }
    try {
      await refreshRulePackSource(pack.id);
      const state = (await loadRulePackSources())[pack.id];
      if (state?.status === "cached" || state?.status === "error") cached += 1;
      else refreshed += 1;
    } catch {
      cached += 1;
    }
  }

  await reconcileProxy("rulePacks.scheduledRefresh", true);
  return { refreshed, cached, skipped };
}

export async function migrateStoredData(): Promise<void> {
  await migrateLegacyProxyConfig();
  const [customDefinitions, enabledIds, sources, stored] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadEnabledCustomRulePackIds(),
    loadRulePackSources(),
    chrome.storage.local.get(["schemaVersion", LEGACY_RULE_SOURCE_STRATEGIES_KEY]),
  ]);
  if (stored.schemaVersion === 5) return;

  const knownCustomIds = new Set(customDefinitions.map((pack) => pack.id));
  const legacyStrategies = stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] &&
    typeof stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] === "object"
    ? stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] as Record<string, unknown>
    : {};
  const validIds = new Set([...knownCustomIds, ...MANAGED_RULE_PACK_IDS]);
  const migratedSources: RulePackSources = {};

  for (const [id, source] of Object.entries(sources)) {
    if (!validIds.has(id)) continue;
    migratedSources[id] = {
      ...source,
      sourceStrategy: normalizeRuleSourceStrategy(source.sourceStrategy ?? legacyStrategies[id]),
    };
  }

  await chrome.storage.local.set({
    schemaVersion: 5,
    [RULE_PACK_DEFINITIONS_KEY]: customDefinitions,
    [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => knownCustomIds.has(id)),
    [RULE_PACK_SOURCES_KEY]: migratedSources,
    [PROXY_SUBSCRIPTION_URL_KEY]: (await chrome.storage.local.get(PROXY_SUBSCRIPTION_URL_KEY))[PROXY_SUBSCRIPTION_URL_KEY]
      ?? DEFAULT_PROXY_SUBSCRIPTION_URL,
  });
  await chrome.storage.local.remove([
    LEGACY_RULE_SOURCE_STRATEGIES_KEY,
    SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
    UI_MODE_KEY,
  ]);
}

export async function resetManagedRulePack(packId: string): Promise<void> {
  if (!MANAGED_RULE_PACK_IDS.includes(packId)) {
    throw new Error("该规则不是默认规则");
  }

  const [previousOverrides, previousSources] = await Promise.all([
    loadManagedRuleOverrides(),
    loadRulePackSources(),
  ]);
  const overrides = { ...previousOverrides };
  delete overrides[packId];
  const sources = { ...previousSources };
  delete sources[packId];

  await Promise.all([
    saveManagedRuleOverrides(overrides),
    saveRulePackSources(sources),
  ]);

  try {
    // 恢复后立即尝试重新获取产品默认订阅；失败时仍使用 catalog 内置最小规则。
    await refreshRulePackSource(packId);
    await reconcileProxy("managedRulePack.reset", true);
  } catch (error) {
    await Promise.all([
      saveManagedRuleOverrides(previousOverrides),
      saveRulePackSources(previousSources),
    ]);
    throw error;
  }
}

export async function refreshRulePack(packId: string): Promise<void> {
  await refreshRulePackSource(packId);
  await reconcileProxy("rulePackSource.refreshed", true);
}

export async function deleteRulePack(packId: string): Promise<void> {
  if (MANAGED_RULE_PACK_IDS.includes(packId)) {
    throw new Error("默认规则由 Auto Proxy 管理，不能删除");
  }
  const [definitions, sources, enabledIds] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadRulePackSources(),
    loadEnabledCustomRulePackIds(),
  ]);
  try {
    await Promise.all([
      saveCustomRulePackDefinitions(definitions.filter((pack) => pack.id !== packId)),
      saveRulePackSources(Object.fromEntries(Object.entries(sources).filter(([id]) => id !== packId))),
      chrome.storage.local.set({
        [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => id !== packId),
      }),
    ]);
    await reconcileProxy("rulePack.deleted", true);
  } catch (error) {
    await Promise.all([
      saveCustomRulePackDefinitions(definitions),
      saveRulePackSources(sources),
      chrome.storage.local.set({ [ENABLED_RULE_PACK_IDS_KEY]: enabledIds }),
    ]);
    throw error;
  }
}

export async function updateFallbackMode(
  fallbackMode: FallbackMode,
): Promise<{ fallbackMode: FallbackMode; reapplied: boolean }> {
  if (fallbackMode !== "direct" && fallbackMode !== "proxy" && fallbackMode !== "system") {
    throw new Error("未命中策略无效");
  }
  const previous = await loadFallbackMode();
  await chrome.storage.local.set({ [FALLBACK_MODE_KEY]: fallbackMode });
  try {
    const reapplied = await reconcileProxy("fallbackMode.updated", true);
    return { fallbackMode, reapplied };
  } catch (error) {
    await chrome.storage.local.set({ [FALLBACK_MODE_KEY]: previous });
    throw error;
  }
}

export async function beginNetworkInfoCheck(): Promise<ProxyConfig> {
  const config = toProxyConfig(await getEffectiveProxy());
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  const probePac: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      mandatory: true,
      data: [
        "function FindProxyForURL(url, host) {",
        '  if (host === "myip.ipip.net") return "DIRECT";',
        `  return ${JSON.stringify(`PROXY ${config.host}:${config.port}`)};`,
        "}",
      ].join("\n"),
    },
  };
  await chrome.proxy.settings.set({ value: probePac, scope: "regular" });
  return config;
}

export async function finishNetworkInfoCheck(): Promise<void> {
  if (await getDesiredEnabled()) {
    await reconcileProxy("networkInfoCheck.finished", true);
    return;
  }
  await chrome.proxy.settings.clear({ scope: "regular" });
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const [effective, desiredEnabled, stored, provider, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    getDesiredEnabled(),
    chrome.storage.local.get([PROXY_EVENT_KEY, LAST_PROXY_ERROR_KEY, RULE_ENGINE_STATUS_KEY]),
    getProxyProviderState(),
    loadFallbackMode(),
  ]);

  return {
    desiredEnabled,
    applied: desiredEnabled && (fallbackMode === "system"
      ? effective.mode === "system"
      : effective.mode === "pac_script" && effective.levelOfControl === "controlled_by_this_extension"),
    mode: effective.mode,
    levelOfControl: effective.levelOfControl,
    proxyEndpoint: proxyEndpoint(provider.activeProxy),
    proxyHost: provider.activeProxy.host,
    proxyPort: provider.activeProxy.port,
    proxyName: provider.activeProxy.name,
    proxyNodeId: provider.activeProxy.id,
    proxySource: provider.effectiveSource,
    fallbackMode,
    lastEvent: stored[PROXY_EVENT_KEY] as ProxyEvent | undefined,
    lastProxyError: stored[LAST_PROXY_ERROR_KEY] as ProxyStatus["lastProxyError"],
    ruleEngineStatus: stored[RULE_ENGINE_STATUS_KEY] as ProxyStatus["ruleEngineStatus"],
  };
}

// 导出默认值用于设置页说明和测试，不参与运行时分支。
export { BUILTIN_FALLBACK_PROXY, DEFAULT_ENABLED_RULE_PACK_IDS, PROXY_SOURCE_MODE_KEY };
