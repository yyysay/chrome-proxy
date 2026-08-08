import {
  BUILTIN_RULE_PACKS,
  BUILTIN_RULE_PACK_IDS,
  DEFAULT_RULE_PACKS,
  MANAGED_RULE_PACK_IDS,
} from "./catalog.ts";
import { analyzeProviderRules } from "./provider-parser.ts";
import type {
  RulePackDefinition,
  RulePackSourceState,
  RuleSourceStrategy,
} from "./types.ts";
import {
  DISABLED_DEFAULT_RULE_PACK_IDS_KEY,
  ENABLED_RULE_PACK_IDS_KEY,
  MANAGED_RULE_OVERRIDES_KEY,
  RULE_PACK_DEFINITIONS_KEY,
  RULE_PACK_SOURCES_KEY,
} from "../shared/storage-keys.ts";

export type RulePackSources = Record<string, RulePackSourceState>;
export type ManagedRuleOverride = Partial<Pick<RulePackDefinition, "name" | "defaultUrl" | "defaultAction">>;
export type ManagedRuleOverrides = Record<string, ManagedRuleOverride>;

export function builtinRuleIds(): string[] {
  return [...BUILTIN_RULE_PACK_IDS];
}

export function isManagedDefinition(pack: RulePackDefinition): boolean {
  return MANAGED_RULE_PACK_IDS.includes(pack.id);
}

export function isBuiltinDefinition(pack: RulePackDefinition): boolean {
  return BUILTIN_RULE_PACK_IDS.includes(pack.id);
}

export function managedRuleSourceHosts(definitions: readonly RulePackDefinition[]): string[] {
  const hosts = new Set<string>();
  for (const pack of definitions) {
    if (!isManagedDefinition(pack) || !pack.defaultUrl) continue;
    try {
      hosts.add(new URL(pack.defaultUrl).hostname.toLowerCase());
    } catch {
      // 无效 URL 会在保存或刷新时给出明确错误。
    }
  }
  return [...hosts];
}

export async function loadEnabledCustomRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(ENABLED_RULE_PACK_IDS_KEY);
  const value = stored[ENABLED_RULE_PACK_IDS_KEY] as unknown;
  if (!Array.isArray(value)) return [];
  const reserved = new Set([...MANAGED_RULE_PACK_IDS, ...BUILTIN_RULE_PACK_IDS]);
  return value.filter((id): id is string => typeof id === "string" && !reserved.has(id));
}

export async function loadDisabledDefaultRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(DISABLED_DEFAULT_RULE_PACK_IDS_KEY);
  const value = stored[DISABLED_DEFAULT_RULE_PACK_IDS_KEY] as unknown;
  if (!Array.isArray(value)) return [];
  const managed = new Set(MANAGED_RULE_PACK_IDS);
  return value.filter((id): id is string => typeof id === "string" && managed.has(id));
}

export async function loadEnabledDefaultRulePackIds(): Promise<string[]> {
  const disabled = new Set(await loadDisabledDefaultRulePackIds());
  return MANAGED_RULE_PACK_IDS.filter((id) => !disabled.has(id));
}

export async function loadActiveEnabledRulePackIds(): Promise<string[]> {
  const [custom, defaults] = await Promise.all([
    loadEnabledCustomRulePackIds(),
    loadEnabledDefaultRulePackIds(),
  ]);
  return [...custom, ...defaults, ...builtinRuleIds()];
}

function isReservedDefinition(pack: RulePackDefinition): boolean {
  return [...DEFAULT_RULE_PACKS, ...BUILTIN_RULE_PACKS].some((reserved) =>
    pack.id === reserved.id ||
    (Boolean(pack.defaultUrl) && pack.defaultUrl === reserved.defaultUrl && pack.name === reserved.name));
}

export async function loadCustomRulePackDefinitions(): Promise<RulePackDefinition[]> {
  const stored = await chrome.storage.local.get(RULE_PACK_DEFINITIONS_KEY);
  const value = stored[RULE_PACK_DEFINITIONS_KEY] as unknown;
  if (!Array.isArray(value)) return [];
  return (value as RulePackDefinition[])
    .filter((pack) => pack && typeof pack.id === "string" &&
      pack.kind !== "managed" && pack.kind !== "builtin" && !isReservedDefinition(pack))
    .map((pack) => ({ ...pack, kind: "custom" as const }));
}

export async function loadManagedRuleOverrides(): Promise<ManagedRuleOverrides> {
  const stored = await chrome.storage.local.get(MANAGED_RULE_OVERRIDES_KEY);
  const value = stored[MANAGED_RULE_OVERRIDES_KEY] as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ManagedRuleOverrides;
}

export async function saveManagedRuleOverrides(overrides: ManagedRuleOverrides): Promise<void> {
  await chrome.storage.local.set({ [MANAGED_RULE_OVERRIDES_KEY]: overrides });
}

export async function loadRulePackDefinitions(): Promise<RulePackDefinition[]> {
  const [custom, overrides] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadManagedRuleOverrides(),
  ]);
  const managed = DEFAULT_RULE_PACKS.map((pack) => ({
    ...pack,
    ...(overrides[pack.id] ?? {}),
    kind: "managed" as const,
  }));
  const builtin = BUILTIN_RULE_PACKS.map((pack) => ({
    ...pack,
    kind: "builtin" as const,
  }));
  // compiler 使用 first-rule-wins：自定义 > 默认订阅 > 内置规则。
  return [...custom, ...managed, ...builtin];
}

export async function saveCustomRulePackDefinitions(
  definitions: readonly RulePackDefinition[],
): Promise<void> {
  await chrome.storage.local.set({
    [RULE_PACK_DEFINITIONS_KEY]: definitions.filter((pack) =>
      !isManagedDefinition(pack) && !isBuiltinDefinition(pack)),
  });
}

export async function loadRulePackSources(): Promise<RulePackSources> {
  const stored = await chrome.storage.local.get(RULE_PACK_SOURCES_KEY);
  const value = stored[RULE_PACK_SOURCES_KEY] as unknown;
  return value && typeof value === "object" ? value as RulePackSources : {};
}

export async function saveRulePackSources(sources: RulePackSources): Promise<void> {
  await chrome.storage.local.set({ [RULE_PACK_SOURCES_KEY]: sources });
}

export function normalizeRuleSourceStrategy(value: unknown): RuleSourceStrategy {
  return value === "local-first" || value === "subscription-first" || value === "merge"
    ? value
    : "subscription-first";
}

export function buildRulePackContent(
  pack: RulePackDefinition,
  source: RulePackSourceState | undefined,
): { rulesText: string; ignored: number; sourceStrategy: RuleSourceStrategy } {
  const sourceStrategy = normalizeRuleSourceStrategy(source?.sourceStrategy);
  const localContent = source?.customContent?.trim() ?? "";
  const subscriptionContent = source?.cachedContent?.trim() ||
    (pack.kind === "builtin" ? pack.rulesText?.trim() : "") || "";
  let selectedContents: string[];

  if (sourceStrategy === "local-first") {
    selectedContents = localContent ? [localContent] : [];
  } else if (sourceStrategy === "subscription-first") {
    selectedContents = subscriptionContent ? [subscriptionContent] : [];
  } else {
    selectedContents = [subscriptionContent, localContent].filter(Boolean);
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

export async function loadRuntimeCatalog(): Promise<RulePackDefinition[]> {
  const [sources, definitions] = await Promise.all([
    loadRulePackSources(),
    loadRulePackDefinitions(),
  ]);
  return definitions.map((pack) => {
    const runtime = buildRulePackContent(pack, sources[pack.id]);
    return { ...pack, rulesText: runtime.rulesText };
  });
}
