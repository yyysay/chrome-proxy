const LEGACY_KEYS = [
  "autoRuleRefreshEnabled", "autoRuleRefreshIntervalMinutes", "autoRuleRefreshIntervalHours",
  "proxySubscriptionRefreshIntervalMinutes", "proxySubscriptionRefreshIntervalHours",
  "fallbackMode", "proxySourceMode", "proxySubscriptionUrl", "proxySubscriptionCache",
  "proxySubscriptionError", "proxyManualOverride", "proxyConfig", "activeProxyId",
  "enabledRulePackIds", "disabledDefaultRulePackIds", "rulePackSources", "rulePackDefinitions",
  "managedRuleOverrides", "ruleSourceStrategies", "simpleEnabledRulePackIds", "uiMode",
  "lastProxyEvent", "ruleEngineStatus",
];

export async function migrateStoredData(): Promise<void> {
  const stored = await chrome.storage.local.get("schemaVersion");
  if (stored.schemaVersion === 9) return;
  await chrome.storage.local.remove(LEGACY_KEYS);
  await chrome.storage.local.set({ schemaVersion: 9 });
}
