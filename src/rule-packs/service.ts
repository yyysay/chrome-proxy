import {
  BUILTIN_RULE_PACK_IDS,
  DEFAULT_RULE_PACKS,
  MANAGED_RULE_PACK_IDS,
} from "./catalog.ts";
import { compileRulePacks } from "./compiler.ts";
import { refreshRulePackSource } from "./downloader.ts";
import {
  buildRulePackContent,
  loadActiveEnabledRulePackIds,
  loadCustomRulePackDefinitions,
  loadDisabledDefaultRulePackIds,
  loadEnabledCustomRulePackIds,
  loadEnabledDefaultRulePackIds,
  loadManagedRuleOverrides,
  loadRulePackDefinitions,
  loadRulePackSources,
  loadRuntimeCatalog,
  normalizeRuleSourceStrategy,
  saveCustomRulePackDefinitions,
  saveManagedRuleOverrides,
  saveRulePackSources,
  type ManagedRuleOverride,
} from "./repository.ts";
import type { RulePackDefinition, RuleSourceStrategy } from "./types.ts";
import {
  DISABLED_DEFAULT_RULE_PACK_IDS_KEY,
  ENABLED_RULE_PACK_IDS_KEY,
} from "../shared/storage-keys.ts";
import { reconcileProxy } from "../proxy/pac-controller.ts";
import { ruleMatchesHostname } from "../proxy/pac-builder.ts";
import { loadFallbackMode } from "../proxy/proxy-state.ts";

export interface DefaultRuleBootstrapResult {
  refreshed: number;
  failed: number;
  skipped: number;
}

export async function bootstrapDefaultRulePacks(): Promise<DefaultRuleBootstrapResult> {
  const [enabledDefaultIds, definitions, sources] = await Promise.all([
    loadEnabledDefaultRulePackIds(),
    loadRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const enabled = new Set(enabledDefaultIds);
  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const pack of definitions) {
    if (!MANAGED_RULE_PACK_IDS.includes(pack.id) || !enabled.has(pack.id)) continue;
    const source = sources[pack.id];
    const sourceStrategy = normalizeRuleSourceStrategy(source?.sourceStrategy);
    const url = source?.url || pack.defaultUrl;
    if (sourceStrategy === "local-first" || !url || source?.cachedContent) {
      skipped += 1;
      continue;
    }

    try {
      await refreshRulePackSource(pack.id);
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }

  if (refreshed > 0) {
    await reconcileProxy("defaultRulePacks.bootstrap", true);
  }
  return { refreshed, failed, skipped };
}

export async function updateEnabledRulePacks(requestedIds: readonly string[]): Promise<{
  enabledPackIds: string[];
  pacReapplied: boolean;
}> {
  const [customDefinitions, definitions] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadRulePackDefinitions(),
  ]);
  const customIds = new Set(customDefinitions.map((pack) => pack.id));
  const requested = new Set(requestedIds);
  const enabledCustomIds = requestedIds.filter((id) => customIds.has(id));
  const enabledDefaultIds = MANAGED_RULE_PACK_IDS.filter((id) => requested.has(id));
  const disabledDefaultIds = MANAGED_RULE_PACK_IDS.filter((id) => !requested.has(id));
  const enabledPackIds = [...enabledCustomIds, ...enabledDefaultIds];
  const [previousEnabledIds, previousDisabledDefaultIds, sources] = await Promise.all([
    loadEnabledCustomRulePackIds(),
    loadDisabledDefaultRulePackIds(),
    loadRulePackSources(),
  ]);

  const definitionById = new Map(definitions.map((pack) => [pack.id, pack]));
  const remoteIds = enabledPackIds.filter((id) => {
    const pack = definitionById.get(id);
    if (!pack) return false;
    const source = sources[id];
    return normalizeRuleSourceStrategy(source?.sourceStrategy) !== "local-first" &&
      Boolean(source?.url || pack.defaultUrl) && !source?.cachedContent;
  });
  await Promise.all(remoteIds.map(refreshRulePackSource));
  await chrome.storage.local.set({
    [ENABLED_RULE_PACK_IDS_KEY]: enabledCustomIds,
    [DISABLED_DEFAULT_RULE_PACK_IDS_KEY]: disabledDefaultIds,
  });

  try {
    const pacReapplied = await reconcileProxy("customRulePacks.updated", true);
    return { enabledPackIds, pacReapplied };
  } catch (error) {
    await chrome.storage.local.set({
      [ENABLED_RULE_PACK_IDS_KEY]: previousEnabledIds,
      [DISABLED_DEFAULT_RULE_PACK_IDS_KEY]: previousDisabledDefaultIds,
    });
    throw error;
  }
}

export async function getRulePackSettings() {
  const [sources, enabledCustomIds, enabledDefaultIds, definitions, managedOverrides] = await Promise.all([
    loadRulePackSources(),
    loadEnabledCustomRulePackIds(),
    loadEnabledDefaultRulePackIds(),
    loadRulePackDefinitions(),
    loadManagedRuleOverrides(),
  ]);
  const enabledDefaults = new Set(enabledDefaultIds);

  return definitions.map((pack) => {
    const source = sources[pack.id] ?? {};
    const runtime = buildRulePackContent(pack, source);
    const runtimePack = { ...pack, rulesText: runtime.rulesText };
    const validation = compileRulePacks([runtimePack], [pack.id]).statistics;
    const managed = MANAGED_RULE_PACK_IDS.includes(pack.id);
    const builtin = BUILTIN_RULE_PACK_IDS.includes(pack.id);
    const baseManaged = managed ? DEFAULT_RULE_PACKS.find((item) => item.id === pack.id) : undefined;
    const customized = managed && Boolean(
      managedOverrides[pack.id] ||
      source.customContent?.trim() ||
      (source.sourceStrategy && source.sourceStrategy !== "subscription-first") ||
      (baseManaged && source.url && source.url !== baseManaged.defaultUrl)
    );
    return {
      ...pack,
      category: builtin ? "builtin" as const : managed ? "default" as const : "custom" as const,
      managed,
      customized,
      enabled: builtin || (managed ? enabledDefaults.has(pack.id) : enabledCustomIds.includes(pack.id)),
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
  sourceStrategy: RuleSourceStrategy = "subscription-first",
): Promise<string> {
  if (!name.trim()) throw new Error("规则名称不能为空");

  if (packId && BUILTIN_RULE_PACK_IDS.includes(packId)) {
    throw new Error("内置规则随扩展发布，不能修改");
  }

  const normalizedStrategy = normalizeRuleSourceStrategy(sourceStrategy);
  const normalizedUrl = url.trim();
  const normalizedCustomContent = customContent.trim();
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
      if (normalizedStrategy !== "local-first" && normalizedUrl &&
          (remoteSourceChanged || !sources[packId].cachedContent)) {
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
    if (normalizedStrategy !== "local-first" && normalizedUrl &&
        (remoteSourceChanged || !sources[id].cachedContent)) {
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
  failed: number;
  skipped: number;
}> {
  const [enabledCustomIds, enabledDefaultIds, definitions, sources] = await Promise.all([
    loadEnabledCustomRulePackIds(),
    loadEnabledDefaultRulePackIds(),
    loadRulePackDefinitions(),
    loadRulePackSources(),
  ]);
  const enabledIds = new Set([...enabledCustomIds, ...enabledDefaultIds]);
  let refreshed = 0;
  let cached = 0;
  let failed = 0;
  let skipped = 0;

  for (const pack of definitions) {
    if (!enabledIds.has(pack.id)) continue;
    const before = sources[pack.id];
    if (normalizeRuleSourceStrategy(before?.sourceStrategy) === "local-first") {
      skipped += 1;
      continue;
    }
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
      if (before?.cachedContent || pack.kind === "builtin" && pack.rulesText ||
          normalizeRuleSourceStrategy(before?.sourceStrategy) === "merge" && before?.customContent) cached += 1;
      else failed += 1;
    }
  }

  await reconcileProxy("rulePacks.scheduledRefresh", true);
  return { refreshed, cached, failed, skipped };
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
  if (BUILTIN_RULE_PACK_IDS.includes(packId)) {
    throw new Error("内置规则随扩展发布，不能删除");
  }
  if (MANAGED_RULE_PACK_IDS.includes(packId)) {
    throw new Error("默认规则不能删除，可以恢复预设配置");
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
