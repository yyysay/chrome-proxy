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
  LEGACY_RULE_SOURCE_STRATEGIES_KEY,
  PROXY_SUBSCRIPTION_URL_KEY,
  RULE_PACK_DEFINITIONS_KEY,
  RULE_PACK_SOURCES_KEY,
  SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
  UI_MODE_KEY,
} from "../shared/storage-keys.ts";
import {
  DEFAULT_PROXY_SUBSCRIPTION_URL,
  migrateLegacyProxyConfig,
} from "./proxy-provider.ts";

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
