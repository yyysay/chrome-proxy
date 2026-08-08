export {
  disableProxy,
  enableProxy,
  getProxyStatus,
  reconcileProxy,
  updateFallbackMode,
} from "./pac-controller.ts";
export type { ProxyStatus } from "./pac-controller.ts";

export {
  getProxyProviderSettings,
  refreshProxySubscription,
  saveManualProxyConfig,
  updateProxySourceMode,
  updateProxySubscriptionUrl,
} from "./proxy-source-service.ts";

export {
  bootstrapDefaultRulePacks,
  deleteRulePack,
  getRulePackSettings,
  refreshEnabledRulePacks,
  refreshRulePack,
  resetManagedRulePack,
  saveRulePack,
  testRuleMatch,
  updateEnabledRulePacks,
} from "../rule-packs/service.ts";

export {
  beginNetworkInfoCheck,
  finishNetworkInfoCheck,
} from "./network-probe.ts";
export { migrateStoredData } from "./storage-migration.ts";
export { runExclusiveProxyMutation } from "./proxy-state.ts";
export type { ProxyConfig } from "./proxy-state.ts";
export type { FallbackMode } from "../shared/runtime-protocol.ts";

// 保留稳定的公共出口，设置页说明和既有测试无需了解内部模块布局。
export {
  BUILTIN_FALLBACK_PROXY,
  PROXY_SOURCE_MODE_KEY,
} from "./proxy-provider.ts";
export { DEFAULT_ENABLED_RULE_PACK_IDS } from "../rule-packs/catalog.ts";
