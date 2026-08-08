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
  PROXY_SUBSCRIPTION_CACHE_KEY,
  PROXY_SUBSCRIPTION_ERROR_KEY,
  PROXY_SUBSCRIPTION_URL_KEY,
  RULE_PACK_DEFINITIONS_KEY,
  RULE_PACK_SOURCES_KEY,
  SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
  UI_MODE_KEY,
} from "../shared/storage-keys.ts";
import { migrateLegacyProxyConfig } from "./proxy-provider.ts";

const LEGACY_DEFAULT_PROXY_SUBSCRIPTION_URL = "https://dufs.ms.y3-3am.top/autoproxy/proxies.json";

export async function migrateStoredData(): Promise<void> {
  await migrateLegacyProxyConfig();
  const [customDefinitions, enabledIds, sources, stored] = await Promise.all([
    loadCustomRulePackDefinitions(),
    loadEnabledCustomRulePackIds(),
    loadRulePackSources(),
    chrome.storage.local.get([
      "schemaVersion",
      LEGACY_RULE_SOURCE_STRATEGIES_KEY,
      PROXY_SUBSCRIPTION_URL_KEY,
    ]),
  ]);
  if (stored.schemaVersion === 6) return;

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
    schemaVersion: 6,
    [RULE_PACK_DEFINITIONS_KEY]: customDefinitions,
    [ENABLED_RULE_PACK_IDS_KEY]: enabledIds.filter((id) => knownCustomIds.has(id)),
    [RULE_PACK_SOURCES_KEY]: migratedSources,
  });
  const obsoleteKeys = [
    LEGACY_RULE_SOURCE_STRATEGIES_KEY,
    SIMPLE_ENABLED_RULE_PACK_IDS_KEY,
    UI_MODE_KEY,
  ];
  if (stored[PROXY_SUBSCRIPTION_URL_KEY] === LEGACY_DEFAULT_PROXY_SUBSCRIPTION_URL) {
    obsoleteKeys.push(
      PROXY_SUBSCRIPTION_URL_KEY,
      PROXY_SUBSCRIPTION_CACHE_KEY,
      PROXY_SUBSCRIPTION_ERROR_KEY,
    );
  }
  await chrome.storage.local.remove(obsoleteKeys);
}
