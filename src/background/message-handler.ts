import {
  deleteRulePack,
  disableProxy,
  enableProxy,
  getProxyProviderSettings,
  getProxyStatus,
  getRulePackSettings,
  refreshEnabledRulePacks,
  refreshProxySubscription,
  refreshRulePack,
  resetManagedRulePack,
  saveManualProxyConfig,
  saveRulePack,
  testRuleMatch,
  updateEnabledRulePacks,
  updateFallbackMode,
  updateProxySourceMode,
  updateProxySubscriptionUrl,
} from "../proxy/proxy-manager.ts";
import { formatRefreshInterval } from "../shared/refresh-interval.ts";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";
import { syncActionState } from "./action-state.ts";
import {
  syncProxySubscriptionAlarm,
  updateProxySubscriptionRefreshInterval,
  updateRuleAutoRefreshSettings,
} from "./alarms.ts";
import {
  clearDiagnosticEvents,
  getDiagnosticEvents,
  recordDiagnosticEvent,
} from "./diagnostics.ts";
import { inspectNetworkInfo } from "./network-inspector.ts";

export async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  switch (message.type) {
    case "ENABLE_PROXY": {
      const config = await enableProxy();
      await syncActionState();
      return {
        ok: true,
        message: `代理已启用：http://${config.host}:${config.port}`,
      };
    }

    case "DISABLE_PROXY":
      await disableProxy();
      await syncActionState();
      return { ok: true, message: "扩展代理设置已关闭" };

    case "GET_PROXY_STATUS":
      return { ok: true, data: await getProxyStatus() };

    case "GET_PROXY_PROVIDER_STATE":
      return { ok: true, data: await getProxyProviderSettings() };

    case "SET_PROXY_SOURCE_MODE": {
      const result = await updateProxySourceMode(message.mode);
      await syncActionState();
      return {
        ok: true,
        data: result,
        message: message.mode === "manual" ? "已使用手动代理覆盖" : "已切换到代理订阅",
      };
    }

    case "SAVE_MANUAL_PROXY": {
      const result = await saveManualProxyConfig(message.host, message.port);
      await syncActionState();
      return { ok: true, data: result, message: "手动代理已保存并启用" };
    }

    case "SAVE_PROXY_SUBSCRIPTION": {
      const result = await updateProxySubscriptionUrl(message.url);
      await syncProxySubscriptionAlarm();
      await syncActionState();
      return {
        ok: true,
        data: result,
        message: result.updateFailed
          ? "订阅地址已保存，但本次更新失败"
          : result.usedCached
            ? "订阅地址已保存；更新失败，继续使用上次配置"
            : "代理订阅已保存并更新",
      };
    }

    case "REFRESH_PROXY_SUBSCRIPTION": {
      const result = await refreshProxySubscription();
      await syncActionState();
      return {
        ok: true,
        data: result,
        message: result.updateFailed
          ? "代理订阅更新失败"
          : result.usedCached ? "更新失败，继续使用上次代理配置" : "代理订阅已更新",
      };
    }

    case "UPDATE_PROXY_SUBSCRIPTION_REFRESH": {
      const intervalMinutes = await updateProxySubscriptionRefreshInterval(message.intervalMinutes);
      return {
        ok: true,
        data: { intervalMinutes },
        message: `代理订阅将每 ${formatRefreshInterval(intervalMinutes)}更新`,
      };
    }

    case "UPDATE_RULE_PACKS": {
      const result = await updateEnabledRulePacks(message.enabledPackIds);
      return {
        ok: true,
        data: result,
        message: result.pacReapplied
          ? "规则启用状态已保存，PAC 已重新应用"
          : "规则启用状态已保存",
      };
    }

    case "UPDATE_FALLBACK_MODE": {
      const result = await updateFallbackMode(message.fallbackMode);
      await syncActionState();
      return {
        ok: true,
        data: result,
        message: message.fallbackMode === "direct"
          ? "MATCH 将直接连接"
          : message.fallbackMode === "proxy"
            ? "MATCH 将使用当前代理"
            : "已交还系统代理；规则分流会暂停",
      };
    }

    case "GET_NETWORK_INFO": {
      const result = await inspectNetworkInfo();
      return { ok: true, data: result.data, message: result.message };
    }

    case "GET_RULE_PACK_SETTINGS":
      return { ok: true, data: await getRulePackSettings() };

    case "REFRESH_RULE_PACK":
      await refreshRulePack(message.packId);
      return { ok: true, message: "规则已下载并应用" };

    case "RESET_MANAGED_RULE_PACK":
      await resetManagedRulePack(message.packId);
      return { ok: true, message: "默认规则已恢复为预设订阅" };

    case "SAVE_RULE_PACK": {
      const packId = await saveRulePack(
        message.packId,
        message.name,
        message.url,
        message.action,
        message.customContent,
        message.sourceStrategy,
      );
      return {
        ok: true,
        data: { packId },
        message: "规则已保存并应用",
      };
    }

    case "DELETE_RULE_PACK":
      await deleteRulePack(message.packId);
      return { ok: true, message: "规则已删除" };

    case "UPDATE_RULE_AUTO_REFRESH": {
      const settings = await updateRuleAutoRefreshSettings(
        message.enabled,
        message.intervalMinutes,
      );
      return {
        ok: true,
        data: settings,
        message: settings.enabled
          ? `自动更新已开启：每 ${formatRefreshInterval(settings.intervalMinutes)}`
          : "自动更新已关闭",
      };
    }

    case "TEST_RULE_MATCH":
      return { ok: true, data: await testRuleMatch(message.input) };

    case "REFRESH_ENABLED_RULE_PACKS": {
      const result = await refreshEnabledRulePacks();
      if (result.cached > 0 || result.failed > 0) {
        void recordDiagnosticEvent({
          type: "subscription",
          message: "部分默认规则更新失败",
          details: `使用缓存 ${result.cached} 个，无可用订阅 ${result.failed} 个`,
        });
      }
      return {
        ok: true,
        data: result,
        message: `更新完成：成功 ${result.refreshed}，缓存 ${result.cached}，失败 ${result.failed}，跳过 ${result.skipped}`,
      };
    }

    case "GET_DIAGNOSTIC_EVENTS":
      return { ok: true, data: await getDiagnosticEvents() };

    case "CLEAR_DIAGNOSTIC_EVENTS":
      await clearDiagnosticEvents();
      return { ok: true, message: "诊断记录已清除" };

    default:
      return { ok: false, error: "未知消息类型" };
  }
}
