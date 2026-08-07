import {
  DEFAULT_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../rule-packs/catalog";
import { compileRulePacks } from "../rule-packs/compiler";
import { analyzeProviderRules } from "../rule-packs/provider-parser";
import type {
  RulePackDefinition,
  RulePackSourceState,
  RuleSourceStrategy,
} from "../rule-packs/types";
import { buildPacScript, ruleMatchesHostname } from "./pac-builder";

const PROXY_CONFIG_KEY = "proxyConfig";
const PROXY_STATE_KEY = "proxyState";
const PROXY_EVENT_KEY = "lastProxyEvent";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const SIMPLE_ENABLED_RULE_PACK_IDS_KEY = "simpleEnabledRulePackIds";
const UI_MODE_KEY = "uiMode";
const LAST_PROXY_ERROR_KEY = "lastProxyError";
const FALLBACK_MODE_KEY = "fallbackMode";
const RULE_PACK_SOURCES_KEY = "rulePackSources";
const RULE_PACK_DEFINITIONS_KEY = "rulePackDefinitions";
const RULE_ENGINE_STATUS_KEY = "ruleEngineStatus";
const LEGACY_RULE_SOURCE_STRATEGIES_KEY = "ruleSourceStrategies";
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_RULES = 20_000;
const MAX_PAC_BYTES = 1_500_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type FallbackMode = "direct" | "proxy" | "system";
export type UiMode = "simple" | "expert";

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
  fallbackMode: FallbackMode;
  proxyEndpoint?: string;
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

function isValidProxyConfig(value: unknown): value is ProxyConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Partial<ProxyConfig>;

  return (
    config.type === "http" &&
    typeof config.host === "string" &&
    config.host.length > 0 &&
    typeof config.port === "number" &&
    Number.isInteger(config.port) &&
    config.port >= 1 &&
    config.port <= 65535
  );
}

async function loadProxyConfig(): Promise<ProxyConfig> {
  const stored = await chrome.storage.local.get(PROXY_CONFIG_KEY);
  const config = stored[PROXY_CONFIG_KEY] as unknown;

  if (!isValidProxyConfig(config)) {
    throw new Error("请先保存有效的本地 HTTP 代理配置");
  }

  return config;
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

  await chrome.storage.local.set({
    [PROXY_STATE_KEY]: state,
  });
}

async function recordProxyEvent(event: Omit<ProxyEvent, "occurredAt">): Promise<void> {
  await chrome.storage.local.set({
    [PROXY_EVENT_KEY]: {
      ...event,
      occurredAt: new Date().toISOString(),
    } satisfies ProxyEvent,
  });
}

async function loadEnabledRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(ENABLED_RULE_PACK_IDS_KEY);
  const value = stored[ENABLED_RULE_PACK_IDS_KEY] as unknown;

  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_RULE_PACK_IDS];
  }

  return value.filter((id): id is string => typeof id === "string");
}

async function loadSimpleEnabledRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(SIMPLE_ENABLED_RULE_PACK_IDS_KEY);
  const value = stored[SIMPLE_ENABLED_RULE_PACK_IDS_KEY] as unknown;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((id): id is string => typeof id === "string");
}

async function loadUiMode(): Promise<UiMode> {
  const stored = await chrome.storage.local.get(UI_MODE_KEY);
  return stored[UI_MODE_KEY] === "expert" ? "expert" : "simple";
}

async function loadActiveEnabledRulePackIds(): Promise<string[]> {
  return (await loadUiMode()) === "expert"
    ? loadEnabledRulePackIds()
    : loadSimpleEnabledRulePackIds();
}

async function loadFallbackMode(): Promise<FallbackMode> {
  const stored = await chrome.storage.local.get(FALLBACK_MODE_KEY);
  const value = stored[FALLBACK_MODE_KEY] as unknown;

  return value === "proxy" || value === "system" ? value : "direct";
}

async function loadActiveFallbackMode(): Promise<FallbackMode> {
  return (await loadUiMode()) === "simple" ? "direct" : loadFallbackMode();
}

type RulePackSources = Record<string, RulePackSourceState>;

async function loadRulePackDefinitions() {
  const stored = await chrome.storage.local.get(RULE_PACK_DEFINITIONS_KEY);
  const value = stored[RULE_PACK_DEFINITIONS_KEY] as unknown;
  return Array.isArray(value) ? value as RulePackDefinition[] : [...DEFAULT_RULE_PACKS];
}

async function saveRulePackDefinitions(definitions: readonly unknown[]): Promise<void> {
  await chrome.storage.local.set({ [RULE_PACK_DEFINITIONS_KEY]: definitions });
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
): {
  rulesText: string;
  ignored: number;
  sourceStrategy: RuleSourceStrategy;
} {
  const sourceStrategy = normalizeRuleSourceStrategy(source?.sourceStrategy);
  const localContent = source?.customContent?.trim() ?? "";
  const subscriptionContent =
    source?.cachedContent?.trim() || pack.rulesText?.trim() || "";

  let selectedContents: string[];

  if (sourceStrategy === "local-first") {
    selectedContents = localContent ? [localContent] : subscriptionContent ? [subscriptionContent] : [];
  } else if (sourceStrategy === "subscription-first") {
    selectedContents = subscriptionContent
      ? [subscriptionContent]
      : localContent
        ? [localContent]
        : [];
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
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      normalizedLines.push(trimmed);
    }
  }

  return {
    rulesText: normalizedLines.join("\n"),
    ignored,
    sourceStrategy,
  };
}

async function refreshRulePackSource(packId: string): Promise<void> {
  const definitions = await loadRulePackDefinitions();
  const pack = definitions.find((item) => item.id === packId);

  if (!pack) {
    throw new Error(`未知规则：${packId}`);
  }

  const sources = await loadRulePackSources();
  const current = sources[packId] ?? {};
  const url = current.url || pack.defaultUrl;
  const lastAttemptAt = new Date().toISOString();

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
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("订阅文件超过 2 MB 限制");
    }

    const content = await response.text();

    if (new TextEncoder().encode(content).byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("订阅文件超过 2 MB 限制");
    }

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
      status: current.customContent || current.cachedContent ? "cached" : "error",
      error: error instanceof Error ? error.message : "下载失败",
    };
    await saveRulePackSources(sources);

    if (!current.customContent && !current.cachedContent) {
      throw new Error(`${pack.name} 规则下载失败：${sources[packId].error}`);
    }
  }
}

async function loadRuntimeCatalog() {
  const [sources, definitions] = await Promise.all([
    loadRulePackSources(),
    loadRulePackDefinitions(),
  ]);

  return definitions.map((pack) => {
    const runtime = buildRulePackContent(pack, sources[pack.id]);
    return {
      ...pack,
      rulesText: runtime.rulesText,
    };
  });
}

async function createPacConfig(
  config: ProxyConfig,
): Promise<{
  config: chrome.proxy.ProxyConfig;
  report: {
    statistics: ReturnType<typeof compileRulePacks>["statistics"];
    conflicts: ReturnType<typeof compileRulePacks>["conflicts"];
    pacBytes: number;
    generatedAt: string;
  };
}> {
  const [enabledPackIds, fallbackMode] = await Promise.all([
    loadActiveEnabledRulePackIds(),
    loadActiveFallbackMode(),
  ]);
  const compiled = compileRulePacks(await loadRuntimeCatalog(), enabledPackIds);

  if (compiled.rules.length > MAX_RULES) {
    throw new Error(`有效规则数量 ${compiled.rules.length} 超过 ${MAX_RULES} 条限制`);
  }

  const pac = buildPacScript(
    compiled.rules,
    config,
    fallbackMode === "proxy" ? "PROXY" : "DIRECT",
  );

  const pacBytes = new TextEncoder().encode(pac.script).byteLength;

  if (pacBytes > MAX_PAC_BYTES) {
    throw new Error(`PAC 大小 ${pacBytes} 字节超过 ${MAX_PAC_BYTES} 字节限制`);
  }

  return {
    config: {
      mode: "pac_script",
      pacScript: {
        data: pac.script,
        mandatory: true,
      },
    },
    report: {
      statistics: compiled.statistics,
      conflicts: compiled.conflicts,
      pacBytes,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function readEffectiveSetting(): Promise<{
  mode?: string;
  levelOfControl: string;
}> {
  const result = await chrome.proxy.settings.get({ incognito: false });
  const value = result.value as chrome.proxy.ProxyConfig | undefined;

  return {
    mode: value?.mode,
    levelOfControl: result.levelOfControl,
  };
}

function assertControllable(levelOfControl: string): void {
  if (
    levelOfControl !== "controllable_by_this_extension" &&
    levelOfControl !== "controlled_by_this_extension"
  ) {
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
    await chrome.proxy.settings.set({
      value: generated.config,
      scope: "regular",
    });

    const after = await readEffectiveSetting();

    if (
      after.mode !== "pac_script" ||
      after.levelOfControl !== "controlled_by_this_extension"
    ) {
      throw new Error(
        `PAC 写入后未生效：${after.mode ?? "unknown"} / ${after.levelOfControl}`,
      );
    }

    await chrome.storage.local.set({
      [RULE_ENGINE_STATUS_KEY]: generated.report,
    });
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
  const fallbackMode = await loadActiveFallbackMode();

  if (fallbackMode === "system") {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return;
  }

  await applyPac(await loadProxyConfig());
}

export async function enableTestProxy(): Promise<ProxyConfig> {
  const config = await loadProxyConfig();

  // 先保存用户意图。即使开发模式恰好在下一刻重新加载扩展，
  // 新 Service Worker 也能在 onInstalled 中恢复配置。
  await setDesiredEnabled(true);

  try {
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    await applySelectedMode();
    await recordProxyEvent({
      type: "enabled",
      reason: "user",
      observedMode: "pac_script",
      levelOfControl: "controlled_by_this_extension",
    });
  } catch (error) {
    await setDesiredEnabled(false);
    throw error;
  }

  return config;
}

export async function disableProxy(): Promise<void> {
  // onChange 监听器会看到 clear 事件；先关闭期望状态，避免误恢复。
  await setDesiredEnabled(false);
  await chrome.proxy.settings.clear({ scope: "regular" });
  await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  await recordProxyEvent({ type: "disabled", reason: "user" });
}

export async function reconcileProxy(
  reason: string,
  forceApply = false,
): Promise<boolean> {
  if (!(await getDesiredEnabled())) {
    return false;
  }

  const [current, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    loadActiveFallbackMode(),
  ]);

  if (fallbackMode === "system") {
    if (current.mode === "system") {
      return false;
    }

    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return true;
  }

  if (
    !forceApply &&
    current.mode === "pac_script" &&
    current.levelOfControl === "controlled_by_this_extension"
  ) {
    return false;
  }

  await recordProxyEvent({
    type: "lost",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });

  const config = await loadProxyConfig();
  await applyPac(config);
  await recordProxyEvent({
    type: "restored",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });

  return true;
}

export async function updateEnabledRulePacks(
  requestedIds: readonly string[],
): Promise<{
  enabledPackIds: string[];
  pacReapplied: boolean;
}> {
  const definitions = await loadRulePackDefinitions();
  const definitionById = new Map(definitions.map((pack) => [pack.id, pack]));
  const enabledPackIds = requestedIds.filter((id) => definitionById.has(id));

  const [previousEnabledIds, sources] = await Promise.all([
    loadEnabledRulePackIds(),
    loadRulePackSources(),
  ]);

  const remoteIds = enabledPackIds.filter((id) => {
    const pack = definitionById.get(id);
    if (!pack) return false;

    const source = sources[id];
    const url = source?.url || pack.defaultUrl;
    return Boolean(url) && !source?.cachedContent;
  });
  await Promise.all(remoteIds.map(refreshRulePackSource));

  await chrome.storage.local.set({
    [ENABLED_RULE_PACK_IDS_KEY]: enabledPackIds,
  });

  let pacReapplied: boolean;

  try {
    pacReapplied = await reconcileProxy("rulePacks.updated", true);
  } catch (error) {
    await chrome.storage.local.set({
      [ENABLED_RULE_PACK_IDS_KEY]: previousEnabledIds,
    });
    throw error;
  }

  return {
    enabledPackIds,
    pacReapplied,
  };
}

export async function updateSimpleEnabledRulePacks(
  requestedIds: readonly string[],
): Promise<{
  enabledPackIds: string[];
  pacReapplied: boolean;
}> {
  const definitions = await loadRulePackDefinitions();
  const definitionById = new Map(definitions.map((pack) => [pack.id, pack]));
  const enabledPackIds = requestedIds.filter((id) => definitionById.has(id));

  const [previousEnabledIds, sources] = await Promise.all([
    loadSimpleEnabledRulePackIds(),
    loadRulePackSources(),
  ]);

  const remoteIds = enabledPackIds.filter((id) => {
    const pack = definitionById.get(id);
    if (!pack) return false;
    const source = sources[id];
    const url = source?.url || pack.defaultUrl;
    return Boolean(url) && !source?.cachedContent;
  });
  await Promise.all(remoteIds.map(refreshRulePackSource));

  await chrome.storage.local.set({
    [SIMPLE_ENABLED_RULE_PACK_IDS_KEY]: enabledPackIds,
  });

  let pacReapplied = false;
  try {
    if ((await loadUiMode()) === "simple") {
      pacReapplied = await reconcileProxy("simpleRulePacks.updated", true);
    }
  } catch (error) {
    await chrome.storage.local.set({
      [SIMPLE_ENABLED_RULE_PACK_IDS_KEY]: previousEnabledIds,
    });
    throw error;
  }

  return { enabledPackIds, pacReapplied };
}

export async function updateUiMode(
  mode: UiMode,
): Promise<{ mode: UiMode; pacReapplied: boolean }> {
  const previousMode = await loadUiMode();
  if (previousMode === mode) {
    return { mode, pacReapplied: false };
  }

  await chrome.storage.local.set({ [UI_MODE_KEY]: mode });
  try {
    const pacReapplied = await reconcileProxy("uiMode.updated", true);
    return { mode, pacReapplied };
  } catch (error) {
    await chrome.storage.local.set({ [UI_MODE_KEY]: previousMode });
    await reconcileProxy("uiMode.rollback", true).catch(() => false);
    throw error;
  }
}

export async function getRulePackSettings() {
  const [sources, enabledIds, simpleEnabledIds, definitions] = await Promise.all([
    loadRulePackSources(),
    loadEnabledRulePackIds(),
    loadSimpleEnabledRulePackIds(),
    loadRulePackDefinitions(),
  ]);

  return definitions.map((pack) => {
    const source = sources[pack.id] ?? {};
    const runtime = buildRulePackContent(pack, source);
    const runtimePack = {
      ...pack,
      rulesText: runtime.rulesText,
    };
    const validation = compileRulePacks([runtimePack], [pack.id]).statistics;

    return {
      ...pack,
      enabled: enabledIds.includes(pack.id),
      simpleEnabled: simpleEnabledIds.includes(pack.id),
      sourceStrategy: runtime.sourceStrategy,
      source: {
        ...source,
        sourceStrategy: runtime.sourceStrategy,
      },
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

  if (!trimmed) {
    throw new Error("请输入网址或域名");
  }

  let hostname: string;

  try {
    hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname
      .toLowerCase();
  } catch {
    throw new Error("网址或域名格式无效");
  }

  if (!hostname) {
    throw new Error("网址或域名格式无效");
  }

  const [enabledIds, fallbackMode] = await Promise.all([
    loadActiveEnabledRulePackIds(),
    loadActiveFallbackMode(),
  ]);
  const compiled = compileRulePacks(await loadRuntimeCatalog(), enabledIds);
  const matchedRule = compiled.rules.find((rule) => ruleMatchesHostname(rule, hostname));

  if (matchedRule) {
    return {
      hostname,
      action: matchedRule.action === "DIRECT" ? "DIRECT" : "PROXY",
      matched: true,
      rule: { type: matchedRule.type, value: matchedRule.value },
    };
  }

  return {
    hostname,
    action: fallbackMode === "system"
      ? "SYSTEM"
      : fallbackMode === "proxy" ? "PROXY" : "DIRECT",
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
  if (!name.trim()) {
    throw new Error("规则名称不能为空");
  }

  const normalizedStrategy = normalizeRuleSourceStrategy(sourceStrategy);
  const normalizedUrl = url.trim();
  const normalizedCustomContent = customContent.trim();

  if (!normalizedUrl && !normalizedCustomContent) {
    throw new Error("订阅地址和本地规则内容至少填写一项");
  }

  const [definitions, previousSources] = await Promise.all([
    loadRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const previousDefinitions = definitions.map((item) => ({ ...item }));
  const id = packId || crypto.randomUUID();
  const existingIndex = definitions.findIndex((item) => item.id === id);
  const definition = {
    id,
    name: name.trim(),
    description: "自定义规则",
    enabledByDefault: false,
    defaultUrl: normalizedUrl,
    defaultAction: action,
  } as const;

  if (existingIndex >= 0) {
    definitions[existingIndex] = definition;
  } else {
    definitions.push(definition);
  }
  await saveRulePackDefinitions(definitions);

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
    cachedContent: remoteSourceChanged || !normalizedUrl
      ? undefined
      : previousSource.cachedContent,
    updatedAt: remoteSourceChanged || !normalizedUrl
      ? undefined
      : previousSource.updatedAt,
    modifiedAt: new Date().toISOString(),
    error: undefined,
  };
  await saveRulePackSources(sources);

  try {
    // 只要配置了订阅地址，就维护一份远程缓存。
    // local-first 会优先使用本地内容，但订阅仍可后台保持新鲜；
    // subscription-first / merge 则会直接消费这份缓存。
    if (normalizedUrl && (remoteSourceChanged || !sources[id].cachedContent)) {
      await refreshRulePackSource(id);
    }

    await reconcileProxy("rulePackSource.updated", true);
  } catch (error) {
    await Promise.all([
      saveRulePackDefinitions(previousDefinitions),
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
  const [expertEnabledIds, simpleEnabledIds, definitions, sources] = await Promise.all([
    loadEnabledRulePackIds(),
    loadSimpleEnabledRulePackIds(),
    loadRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const enabledIds = [...new Set([...expertEnabledIds, ...simpleEnabledIds])];
  const definitionById = new Map(definitions.map((pack) => [pack.id, pack]));
  let refreshed = 0;
  let cached = 0;
  let skipped = 0;

  for (const id of enabledIds) {
    const pack = definitionById.get(id);
    if (!pack) {
      skipped += 1;
      continue;
    }

    const before = sources[id];
    const url = before?.url || pack.defaultUrl;

    if (!url) {
      skipped += 1;
      continue;
    }

    try {
      await refreshRulePackSource(id);
      const state = (await loadRulePackSources())[id];
      if (state?.status === "cached" || state?.status === "error") {
        cached += 1;
      } else {
        refreshed += 1;
      }
    } catch {
      cached += 1;
    }
  }

  await reconcileProxy("rulePacks.scheduledRefresh", true);
  return { refreshed, cached, skipped };
}

export async function migrateStoredData(): Promise<void> {
  const [definitions, enabledIds, simpleEnabledIds, sources, stored] = await Promise.all([
    loadRulePackDefinitions(),
    loadEnabledRulePackIds(),
    loadSimpleEnabledRulePackIds(),
    loadRulePackSources(),
    chrome.storage.local.get([
      "schemaVersion",
      LEGACY_RULE_SOURCE_STRATEGIES_KEY,
    ]),
  ]);

  if (stored.schemaVersion === 3) {
    return;
  }

  const knownIds = new Set(definitions.map((pack) => pack.id));
  const legacyStrategies =
    stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] &&
    typeof stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] === "object"
      ? stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] as Record<string, unknown>
      : {};

  const migratedSources: RulePackSources = {};

  for (const pack of definitions) {
    const source = sources[pack.id];
    const legacyStrategy = legacyStrategies[pack.id];

    if (!source && legacyStrategy === undefined) {
      continue;
    }

    migratedSources[pack.id] = {
      ...(source ?? {}),
      sourceStrategy: normalizeRuleSourceStrategy(
        source?.sourceStrategy ?? legacyStrategy,
      ),
    };
  }

  await chrome.storage.local.set({
    schemaVersion: 3,
    [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => knownIds.has(id)),
    [SIMPLE_ENABLED_RULE_PACK_IDS_KEY]: simpleEnabledIds.filter((id) => knownIds.has(id)),
    [RULE_PACK_SOURCES_KEY]: migratedSources,
  });
  await chrome.storage.local.remove(LEGACY_RULE_SOURCE_STRATEGIES_KEY);
}

export async function refreshRulePack(packId: string): Promise<void> {
  await refreshRulePackSource(packId);
  await reconcileProxy("rulePackSource.refreshed", true);
}

export async function deleteRulePack(packId: string): Promise<void> {
  const [definitions, sources, enabledIds, simpleEnabledIds] = await Promise.all([
    loadRulePackDefinitions(),
    loadRulePackSources(),
    loadEnabledRulePackIds(),
    loadSimpleEnabledRulePackIds(),
  ]);
  try {
    await Promise.all([
      saveRulePackDefinitions(definitions.filter((pack) => pack.id !== packId)),
      saveRulePackSources(Object.fromEntries(
        Object.entries(sources).filter(([id]) => id !== packId),
      )),
      chrome.storage.local.set({
        [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => id !== packId),
        [SIMPLE_ENABLED_RULE_PACK_IDS_KEY]: simpleEnabledIds.filter((id) => id !== packId),
      }),
    ]);
    await reconcileProxy("rulePack.deleted", true);
  } catch (error) {
    await Promise.all([
      saveRulePackDefinitions(definitions),
      saveRulePackSources(sources),
      chrome.storage.local.set({
        [ENABLED_RULE_PACK_IDS_KEY]: enabledIds,
        [SIMPLE_ENABLED_RULE_PACK_IDS_KEY]: simpleEnabledIds,
      }),
    ]);
    throw error;
  }
}

export async function updateFallbackMode(
  fallbackMode: FallbackMode,
): Promise<{ fallbackMode: FallbackMode; reapplied: boolean }> {
  const previousFallbackMode = await loadFallbackMode();
  await chrome.storage.local.set({
    [FALLBACK_MODE_KEY]: fallbackMode,
  });

  let reapplied: boolean;

  try {
    reapplied = await reconcileProxy("fallbackMode.updated", true);
  } catch (error) {
    await chrome.storage.local.set({
      [FALLBACK_MODE_KEY]: previousFallbackMode,
    });
    throw error;
  }
  return { fallbackMode, reapplied };
}

export async function beginNetworkInfoCheck(): Promise<ProxyConfig> {
  const config = await loadProxyConfig();
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  // 使用两个不同域名同时探测：IPIP 强制 DIRECT，其余请求在探测窗口内走当前 HTTP 代理。
  // 这样能拿到“本地直连出口”和“代理出口”，同时避免临时检测期间把其他浏览流量意外直连。
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

  await chrome.proxy.settings.set({
    value: probePac,
    scope: "regular",
  });

  return config;
}

export async function beginProxyConnectivityCheck(): Promise<ProxyConfig> {
  const config = await loadProxyConfig();
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  const validationPac: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      mandatory: true,
      data: [
        "function FindProxyForURL(url, host) {",
        `  return ${JSON.stringify(`PROXY ${config.host}:${config.port}`)};`,
        "}",
      ].join("\n"),
    },
  };

  await chrome.proxy.settings.set({
    value: validationPac,
    scope: "regular",
  });

  return config;
}

export async function finishProxyConnectivityCheck(): Promise<void> {
  if (await getDesiredEnabled()) {
    await reconcileProxy("connectivityCheck.finished", true);
    return;
  }

  await chrome.proxy.settings.clear({ scope: "regular" });
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const [
    effective,
    desiredEnabled,
    stored,
    configStored,
    fallbackMode,
  ] = await Promise.all([
    readEffectiveSetting(),
    getDesiredEnabled(),
    chrome.storage.local.get([
      PROXY_EVENT_KEY,
      LAST_PROXY_ERROR_KEY,
      RULE_ENGINE_STATUS_KEY,
    ]),
    chrome.storage.local.get(PROXY_CONFIG_KEY),
    loadActiveFallbackMode(),
  ]);
  const config = configStored[PROXY_CONFIG_KEY] as unknown;

  return {
    desiredEnabled,
    applied: desiredEnabled && (
      fallbackMode === "system"
        ? effective.mode === "system"
        : effective.mode === "pac_script" &&
          effective.levelOfControl === "controlled_by_this_extension"
    ),
    mode: effective.mode,
    levelOfControl: effective.levelOfControl,
    fallbackMode,
    proxyEndpoint: isValidProxyConfig(config)
      ? `http://${config.host}:${config.port}`
      : undefined,
    lastEvent: stored[PROXY_EVENT_KEY] as ProxyEvent | undefined,
    lastProxyError: stored[LAST_PROXY_ERROR_KEY] as
      | {
          error: string;
          details: string;
          fatal: boolean;
          occurredAt: string;
        }
      | undefined,
    ruleEngineStatus: stored[RULE_ENGINE_STATUS_KEY] as
      | ProxyStatus["ruleEngineStatus"]
      | undefined,
  };
}
