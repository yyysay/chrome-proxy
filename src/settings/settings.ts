import "../ui/ui.css";
import type { ProxyProviderState } from "../proxy/proxy-provider.ts";
import type { FallbackMode } from "../shared/runtime-protocol.ts";
import {
  ACTIVE_SETTINGS_TAB_KEY,
  AUTO_REFRESH_ENABLED_KEY,
  AUTO_REFRESH_INTERVAL_KEY,
  FALLBACK_MODE_KEY,
  INSTALL_TIME_KEY,
  LEGACY_AUTO_REFRESH_INTERVAL_KEY,
  LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
  NETWORK_INFO_CACHE_KEY,
  PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
} from "../shared/storage-keys.ts";
import { initializeNavigation, type SettingsTab } from "./navigation.ts";
import { initializeNetworkInfo } from "./network-info.ts";
import { initializeProxySettings } from "./proxy-settings.ts";
import { storedRefreshIntervalMinutes } from "./refresh-controls.ts";
import { refreshAllRelativeTimeStatuses } from "./relative-time.ts";
import { initializeRuleSettings } from "./rule-settings.ts";
import { sendMessage } from "./runtime-client.ts";
import { showToast } from "./toast.ts";
import type { RulePackSetting } from "./types.ts";

interface InitialSettings {
  installedAt?: string;
  activeTab: SettingsTab;
  provider: ProxyProviderState;
  networkCache: unknown;
  rules: RulePackSetting[];
  fallbackMode: FallbackMode;
  ruleRefresh: {
    enabled: boolean;
    intervalMinutes: number;
  };
  proxyRefreshIntervalMinutes: number;
}

function fallbackModeFrom(value: unknown): FallbackMode {
  return value === "proxy" || value === "system" ? value : "direct";
}

async function loadInitialSettings(): Promise<InitialSettings> {
  const [stored, providerResponse, rulesResponse] = await Promise.all([
    chrome.storage.local.get([
      INSTALL_TIME_KEY,
      ACTIVE_SETTINGS_TAB_KEY,
      AUTO_REFRESH_ENABLED_KEY,
      AUTO_REFRESH_INTERVAL_KEY,
      LEGACY_AUTO_REFRESH_INTERVAL_KEY,
      NETWORK_INFO_CACHE_KEY,
      FALLBACK_MODE_KEY,
      PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
      LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
    ]),
    sendMessage<ProxyProviderState>({ type: "GET_PROXY_PROVIDER_STATE" }),
    sendMessage<RulePackSetting[]>({ type: "GET_RULE_PACK_SETTINGS" }),
  ]);

  if (!providerResponse.ok || !providerResponse.data) {
    throw new Error(providerResponse.error ?? "代理配置读取失败");
  }
  if (!rulesResponse.ok || !rulesResponse.data) {
    throw new Error(rulesResponse.error ?? "规则读取失败");
  }

  return {
    installedAt: typeof stored[INSTALL_TIME_KEY] === "string"
      ? stored[INSTALL_TIME_KEY]
      : undefined,
    activeTab: stored[ACTIVE_SETTINGS_TAB_KEY] === "rules" ? "rules" : "proxy",
    provider: providerResponse.data,
    networkCache: stored[NETWORK_INFO_CACHE_KEY],
    rules: rulesResponse.data,
    fallbackMode: fallbackModeFrom(stored[FALLBACK_MODE_KEY]),
    ruleRefresh: {
      enabled: stored[AUTO_REFRESH_ENABLED_KEY] !== false,
      intervalMinutes: storedRefreshIntervalMinutes(
        stored,
        AUTO_REFRESH_INTERVAL_KEY,
        LEGACY_AUTO_REFRESH_INTERVAL_KEY,
        1_440,
      ),
    },
    proxyRefreshIntervalMinutes: storedRefreshIntervalMinutes(
      stored,
      PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
      LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
      360,
    ),
  };
}

async function initializeSettings(): Promise<void> {
  const settings = await loadInitialSettings();
  initializeNavigation(settings.activeTab, settings.installedAt);
  initializeProxySettings(settings.provider, settings.proxyRefreshIntervalMinutes);
  initializeNetworkInfo(settings.provider, settings.networkCache);
  initializeRuleSettings(settings.rules, settings.fallbackMode, settings.ruleRefresh);
}

window.setInterval(refreshAllRelativeTimeStatuses, 60_000);

void initializeSettings().catch((error) => {
  console.error(error);
  showToast(error instanceof Error ? error.message : "读取配置失败", "error");
});
