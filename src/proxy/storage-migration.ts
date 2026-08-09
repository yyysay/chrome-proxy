import {
  BUILTIN_RULE_PACK_IDS,
  MANAGED_RULE_PACK_IDS,
} from "../rule-packs/catalog.ts";
import {
  loadCustomRulePackDefinitions,
  loadEnabledCustomRulePackIds,
  loadRulePackSources,
  normalizeRuleSourceStrategy,
  type RulePackSources,
} from "../rule-packs/repository.ts";
import {
  ENABLED_RULE_PACK_IDS_KEY,
  DISABLED_DEFAULT_RULE_PACK_IDS_KEY,
  LEGACY_RULE_SOURCE_STRATEGIES_KEY,
  MANAGED_RULE_OVERRIDES_KEY,
  RULE_PACK_DEFINITIONS_KEY,
  RULE_PACK_SOURCES_KEY,
  SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
  UI_MODE_KEY,
} from "../shared/storage-keys.ts";
import { migrateLegacyProxyConfig } from "./proxy-provider.ts";

export async function migrateStoredData(): Promise<void> {
  await migrateLegacyProxyConfig();
  const [customDefinitions, enabledIds, sources, stored] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadEnabledCustomRulePackIds(),
    loadRulePackSources(),
    chrome.storage.local.get([
      "schemaVersion",
      LEGACY_RULE_SOURCE_STRATEGIES_KEY,
      DISABLED_DEFAULT_RULE_PACK_IDS_KEY,
      MANAGED_RULE_OVERRIDES_KEY,
    ]),
  ]);
  if (stored.schemaVersion === 7) return;

  const knownCustomIds = new Set(customDefinitions.map((pack) => pack.id));
  const legacyStrategies = stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] &&
    typeof stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] === "object"
    ? stored[LEGACY_RULE_SOURCE_STRATEGIES_KEY] as Record<string, unknown>
    : {};
  const validIds = new Set([
    ...knownCustomIds,
    ...MANAGED_RULE_PACK_IDS,
    ...BUILTIN_RULE_PACK_IDS,
  ]);
  const migratedSources: RulePackSources = {};

  for (const [id, source] of Object.entries(sources)) {
    if (!validIds.has(id)) continue;
    migratedSources[id] = {
      ...source,
      sourceStrategy: normalizeRuleSourceStrategy(source.sourceStrategy ?? legacyStrategies[id]),
    };
  }

  const disabledDefaults = Array.isArray(stored[DISABLED_DEFAULT_RULE_PACK_IDS_KEY])
    ? stored[DISABLED_DEFAULT_RULE_PACK_IDS_KEY].filter((id): id is string =>
      typeof id === "string" && MANAGED_RULE_PACK_IDS.includes(id))
    : [];
  const rawOverrides = stored[MANAGED_RULE_OVERRIDES_KEY];
  const migratedOverrides = rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)
    ? Object.fromEntries(Object.entries(rawOverrides).filter(([id]) => MANAGED_RULE_PACK_IDS.includes(id)))
    : {};

  await chrome.storage.local.set({
    schemaVersion: 7,
    [RULE_PACK_DEFINITIONS_KEY]: customDefinitions,
    [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => knownCustomIds.has(id)),
    [RULE_PACK_SOURCES_KEY]: migratedSources,
    [DISABLED_DEFAULT_RULE_PACK_IDS_KEY]: disabledDefaults,
    [MANAGED_RULE_OVERRIDES_KEY]: migratedOverrides,
  });
  const obsoleteKeys = [
    LEGACY_RULE_SOURCE_STRATEGIES_KEY,
    SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
    UI_MODE_KEY,
  ];
  await chrome.storage.local.remove(obsoleteKeys);
}
