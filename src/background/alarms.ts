import {
  getProxyProviderSettings,
  refreshEnabledRulePacks,
  refreshProxySubscription,
} from "../proxy/proxy-manager.ts";
import {
  DISABLED_REFRESH_INTERVAL_MINUTES,
  isValidRefreshIntervalMinutes,
  legacyHoursToMinutes,
  MAX_REFRESH_INTERVAL_MINUTES,
  MIN_REFRESH_INTERVAL_MINUTES,
  normalizeRefreshIntervalMinutes,
} from "../shared/refresh-interval.ts";
import {
  AUTO_REFRESH_ENABLED_KEY,
  AUTO_REFRESH_INTERVAL_KEY,
  LEGACY_AUTO_REFRESH_INTERVAL_KEY,
  LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
  PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
} from "../shared/storage-keys.ts";
import { recordDiagnosticEvent } from "./diagnostics.ts";

export const RULE_REFRESH_ALARM = "refresh-enabled-rules";
export const PROXY_SUBSCRIPTION_REFRESH_ALARM = "refresh-proxy-subscription";

export interface RuleAutoRefreshSettings {
  enabled: boolean;
  intervalMinutes: number;
}

export async function loadRuleAutoRefreshSettings(): Promise<RuleAutoRefreshSettings> {
  const stored = await chrome.storage.local.get([
    AUTO_REFRESH_ENABLED_KEY,
    AUTO_REFRESH_INTERVAL_KEY,
    LEGACY_AUTO_REFRESH_INTERVAL_KEY,
  ]);
  const legacyMinutes = legacyHoursToMinutes(stored[LEGACY_AUTO_REFRESH_INTERVAL_KEY]);

  return {
    enabled: stored[AUTO_REFRESH_ENABLED_KEY] !== false,
    intervalMinutes: normalizeRefreshIntervalMinutes(
      stored[AUTO_REFRESH_INTERVAL_KEY],
      legacyMinutes ?? 1_440,
    ),
  };
}

export async function syncRuleRefreshAlarm(): Promise<RuleAutoRefreshSettings> {
  const settings = await loadRuleAutoRefreshSettings();

  if (!settings.enabled) {
    await chrome.alarms.clear(RULE_REFRESH_ALARM);
    return settings;
  }

  await chrome.alarms.create(RULE_REFRESH_ALARM, {
    periodInMinutes: settings.intervalMinutes,
  });
  return settings;
}

export async function updateRuleAutoRefreshSettings(
  enabled: boolean,
  intervalMinutes: number,
): Promise<RuleAutoRefreshSettings> {
  const normalizedInterval = normalizeRefreshIntervalMinutes(intervalMinutes);

  if (enabled && !isValidRefreshIntervalMinutes(Number(intervalMinutes))) {
    throw new Error(`自动更新间隔需为 ${MIN_REFRESH_INTERVAL_MINUTES} 到 ${MAX_REFRESH_INTERVAL_MINUTES} 分钟的整数`);
  }

  await chrome.storage.local.set({
    [AUTO_REFRESH_ENABLED_KEY]: enabled,
    [AUTO_REFRESH_INTERVAL_KEY]: normalizedInterval,
  });

  return syncRuleRefreshAlarm();
}

export async function syncProxySubscriptionAlarm(): Promise<void> {
  const state = await getProxyProviderSettings();
  if (!state.subscriptionUrl) {
    await chrome.alarms.clear(PROXY_SUBSCRIPTION_REFRESH_ALARM);
    return;
  }
  const stored = await chrome.storage.local.get([
    PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
    LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY,
  ]);
  if (Number(stored[PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY]) === DISABLED_REFRESH_INTERVAL_MINUTES) {
    await chrome.alarms.clear(PROXY_SUBSCRIPTION_REFRESH_ALARM);
    return;
  }
  const legacyMinutes = legacyHoursToMinutes(stored[LEGACY_PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY]);
  const intervalMinutes = normalizeRefreshIntervalMinutes(
    stored[PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY],
    legacyMinutes ?? 360,
  );
  await chrome.alarms.create(PROXY_SUBSCRIPTION_REFRESH_ALARM, {
    periodInMinutes: intervalMinutes,
  });
}

export async function updateProxySubscriptionRefreshInterval(
  intervalMinutes: number,
): Promise<number> {
  if (intervalMinutes === DISABLED_REFRESH_INTERVAL_MINUTES) {
    await chrome.storage.local.set({
      [PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY]: DISABLED_REFRESH_INTERVAL_MINUTES,
    });
    await chrome.alarms.clear(PROXY_SUBSCRIPTION_REFRESH_ALARM);
    return DISABLED_REFRESH_INTERVAL_MINUTES;
  }
  if (!isValidRefreshIntervalMinutes(intervalMinutes)) {
    throw new Error(`代理订阅更新间隔需为 ${MIN_REFRESH_INTERVAL_MINUTES} 到 ${MAX_REFRESH_INTERVAL_MINUTES} 分钟的整数`);
  }
  await chrome.storage.local.set({
    [PROXY_SUBSCRIPTION_REFRESH_INTERVAL_KEY]: intervalMinutes,
  });
  await syncProxySubscriptionAlarm();
  return intervalMinutes;
}

export function handleRefreshAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === RULE_REFRESH_ALARM) {
    void (async () => {
      const settings = await loadRuleAutoRefreshSettings();
      if (!settings.enabled) {
        await chrome.alarms.clear(RULE_REFRESH_ALARM);
        return;
      }
      const result = await refreshEnabledRulePacks();
      if (result.cached > 0 || result.failed > 0) {
        await recordDiagnosticEvent({
          type: "subscription",
          message: "部分默认规则自动更新失败",
          details: `使用缓存 ${result.cached} 个，无可用订阅 ${result.failed} 个`,
        });
      }
    })().catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "subscription",
        message: "规则自动更新失败",
        details: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  if (alarm.name === PROXY_SUBSCRIPTION_REFRESH_ALARM) {
    void refreshProxySubscription().then((result) => {
      if (result.updateFailed || result.usedCached) {
        void recordDiagnosticEvent({
          type: "subscription",
          message: result.usedCached
            ? "代理订阅更新失败，继续使用上次配置"
            : "代理订阅自动更新失败",
          details: result.updateFailed ?? result.state.subscription?.error,
        });
      }
    }).catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "subscription",
        message: "代理订阅自动更新失败",
        details: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
