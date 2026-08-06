import {
  beginProxyConnectivityCheck,
  disableProxy,
  enableTestProxy,
  finishProxyConnectivityCheck,
  getRulePackSettings,
  getProxyStatus,
  reconcileProxy,
  updateEnabledRulePacks,
  updateFallbackMode,
  saveRulePack,
  refreshRulePack,
  deleteRulePack,
  reorderRulePacks,
  refreshEnabledRulePacks,
  migrateStoredData,
  testRuleMatch,
} from "../proxy/proxy-manager";

const INSTALL_TIME_KEY = "installedAt";
const LAST_PROXY_ERROR_KEY = "lastProxyError";
const DIAGNOSTIC_EVENTS_KEY = "diagnosticEvents";
const RULE_REFRESH_ALARM = "refresh-enabled-rules";
const MAX_DIAGNOSTIC_EVENTS = 30;

interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}

type RuntimeMessage =
  | { type: "ENABLE_TEST_PROXY" }
  | { type: "DISABLE_PROXY" }
  | { type: "GET_PROXY_STATUS" }
  | { type: "UPDATE_RULE_PACKS"; enabledPackIds: string[] }
  | {
      type: "UPDATE_FALLBACK_MODE";
      fallbackMode: "direct" | "proxy" | "system";
    }
  | { type: "CHECK_PROXY_CONNECTIVITY" }
  | { type: "GET_RULE_PACK_SETTINGS" }
  | { type: "REFRESH_RULE_PACK"; packId: string }
  | {
      type: "SAVE_RULE_PACK";
      packId?: string;
      name: string;
      url: string;
      action: "DIRECT" | "PROXY";
      customContent: string;
    }
  | { type: "DELETE_RULE_PACK"; packId: string }
  | { type: "REORDER_RULE_PACKS"; orderedIds: string[] }
  | { type: "TEST_RULE_MATCH"; input: string }
  | { type: "REFRESH_ENABLED_RULE_PACKS" }
  | { type: "GET_DIAGNOSTIC_EVENTS" }
  | { type: "CLEAR_DIAGNOSTIC_EVENTS" };

interface RuntimeResponse {
  ok: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

let reconcileTask: Promise<boolean> | undefined;
let forceReconcileQueued = false;
let diagnosticWrite = Promise.resolve();

async function syncActionState(): Promise<void> {
  const status = await getProxyStatus();
  const active = status.applied;
  await Promise.all([
    chrome.action.setBadgeText({ text: active ? " " : "" }),
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" }),
    chrome.action.setTitle({
      title: active ? "规则分流已开启" : "规则分流已关闭",
    }),
  ]);
}

function recordDiagnosticEvent(
  event: Omit<DiagnosticEvent, "occurredAt">,
): Promise<void> {
  diagnosticWrite = diagnosticWrite.then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_EVENTS_KEY);
    const existing = Array.isArray(stored[DIAGNOSTIC_EVENTS_KEY])
      ? stored[DIAGNOSTIC_EVENTS_KEY] as DiagnosticEvent[]
      : [];
    const next: DiagnosticEvent = {
      ...event,
      occurredAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({
      [DIAGNOSTIC_EVENTS_KEY]: [next, ...existing].slice(0, MAX_DIAGNOSTIC_EVENTS),
    });
  }).catch(() => undefined);

  return diagnosticWrite;
}

function scheduleReconcile(reason: string, forceApply = false): void {
  if (reconcileTask) {
    forceReconcileQueued ||= forceApply;
    return;
  }

  reconcileTask = reconcileProxy(reason, forceApply);

  void reconcileTask
    .catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "background",
        message: "代理状态同步失败",
        details: `${reason}：${error instanceof Error ? error.message : String(error)}`,
      });
    })
    .finally(() => {
      reconcileTask = undefined;
      void syncActionState().catch(() => undefined);

      if (forceReconcileQueued) {
        forceReconcileQueued = false;
        scheduleReconcile("proxyConfig.queuedChange", true);
      }
    });
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await migrateStoredData();
    await chrome.alarms.create(RULE_REFRESH_ALARM, { periodInMinutes: 24 * 60 });
    const stored = await chrome.storage.local.get(INSTALL_TIME_KEY);

    if (!stored[INSTALL_TIME_KEY]) {
      await chrome.storage.local.set({
        [INSTALL_TIME_KEY]: new Date().toISOString(),
      });
    }

    if (details.reason === "install") {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("onboarding.html"),
      });
    }

    // 开发模式更新 dist 后，Chrome 会重新加载扩展并清除它控制的设置。
    // onInstalled 在重新加载完成后触发，此时再根据持久状态恢复 PAC。
    scheduleReconcile(`runtime.${details.reason}`);
    await syncActionState();
  })().catch((error: unknown) => {
    void recordDiagnosticEvent({
      type: "background",
      message: "扩展初始化失败",
      details: error instanceof Error ? error.message : String(error),
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  void migrateStoredData().then(() => {
    chrome.alarms.create(RULE_REFRESH_ALARM, { periodInMinutes: 24 * 60 });
    scheduleReconcile("runtime.startup");
    void syncActionState().catch(() => undefined);
  }).catch((error: unknown) => {
    void recordDiagnosticEvent({
      type: "background",
      message: "扩展启动迁移失败",
      details: error instanceof Error ? error.message : String(error),
    });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RULE_REFRESH_ALARM) {
    return;
  }

  void refreshEnabledRulePacks()
    .then((result) => {
      if (result.cached > 0) {
        void recordDiagnosticEvent({
          type: "subscription",
          message: "部分规则自动更新失败，已继续使用缓存",
          details: `使用缓存 ${result.cached} 条`,
        });
      }
    })
    .catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "subscription",
        message: "规则自动更新失败",
        details: error instanceof Error ? error.message : String(error),
      });
    });
});

chrome.proxy.settings.onChange.addListener((details) => {
  const value = details.value as chrome.proxy.ProxyConfig | undefined;

  if (
    value?.mode !== "pac_script" ||
    details.levelOfControl !== "controlled_by_this_extension"
  ) {
    scheduleReconcile("proxy.onChange");
  }
});

chrome.proxy.onProxyError.addListener((details) => {
  const errorRecord = {
    error: details.error,
    details: details.details,
    fatal: details.fatal,
    occurredAt: new Date().toISOString(),
  };

  // 仅持久化到扩展内诊断中心，避免 chrome://extensions 被运行时网络错误占满。
  void chrome.storage.local.set({
    [LAST_PROXY_ERROR_KEY]: errorRecord,
  });
  void recordDiagnosticEvent({
    type: "proxy",
    message: details.error,
    details: details.details,
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.proxyConfig) {
    // 设置页保存地址后，若分流处于开启状态，立即用新地址重建 PAC。
    scheduleReconcile("proxyConfig.changed", true);
  }

});

async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  switch (message.type) {
    case "ENABLE_TEST_PROXY": {
      const config = await enableTestProxy();
      await syncActionState();
      return {
        ok: true,
        message: `测试分流已启用：http://${config.host}:${config.port}`,
      };
    }

    case "DISABLE_PROXY":
      await disableProxy();
      await syncActionState();
      return { ok: true, message: "扩展代理设置已关闭" };

    case "GET_PROXY_STATUS":
      return { ok: true, data: await getProxyStatus() };

    case "UPDATE_RULE_PACKS": {
      const result = await updateEnabledRulePacks(message.enabledPackIds);
      return {
        ok: true,
        data: result,
        message: result.pacReapplied
          ? "规则已保存，PAC 已重新应用"
          : "规则已保存；分流未开启，暂不应用 PAC",
      };
    }

    case "UPDATE_FALLBACK_MODE": {
      const result = await updateFallbackMode(message.fallbackMode);
      return {
        ok: true,
        data: result,
        message: message.fallbackMode === "system"
          ? "已交还系统代理；自定义规则分流暂停"
          : "兜底策略已保存，PAC 已更新",
      };
    }

    case "CHECK_PROXY_CONNECTIVITY": {
      const config = await beginProxyConnectivityCheck();

      try {
        const url = `https://ip125.com/?proxy-connectivity-check=${Date.now()}`;
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
          throw new Error(`IP125 返回 HTTP ${response.status}`);
        }

        await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);

        return {
          ok: true,
          message: `局域网代理连接正常：http://${config.host}:${config.port}`,
        };
      } finally {
        await finishProxyConnectivityCheck();
      }
    }

    case "GET_RULE_PACK_SETTINGS":
      return { ok: true, data: await getRulePackSettings() };

    case "REFRESH_RULE_PACK":
      await refreshRulePack(message.packId);
      return { ok: true, message: "规则已下载并应用" };

    case "SAVE_RULE_PACK": {
      const packId = await saveRulePack(
        message.packId,
        message.name,
        message.url,
        message.action,
        message.customContent,
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

    case "REORDER_RULE_PACKS":
      await reorderRulePacks(message.orderedIds);
      return { ok: true, message: "规则优先级已更新" };

    case "TEST_RULE_MATCH":
      return { ok: true, data: await testRuleMatch(message.input) };

    case "REFRESH_ENABLED_RULE_PACKS": {
      const result = await refreshEnabledRulePacks();
      if (result.cached > 0) {
        void recordDiagnosticEvent({
          type: "subscription",
          message: "部分规则更新失败，已继续使用缓存",
          details: `使用缓存 ${result.cached} 条`,
        });
      }
      return {
        ok: true,
        data: result,
        message: `更新完成：成功 ${result.refreshed}，使用缓存 ${result.cached}，跳过本地规则 ${result.skipped}`,
      };
    }

    case "GET_DIAGNOSTIC_EVENTS": {
      const stored = await chrome.storage.local.get(DIAGNOSTIC_EVENTS_KEY);
      return {
        ok: true,
        data: Array.isArray(stored[DIAGNOSTIC_EVENTS_KEY])
          ? stored[DIAGNOSTIC_EVENTS_KEY]
          : [],
      };
    }

    case "CLEAR_DIAGNOSTIC_EVENTS":
      await chrome.storage.local.remove([
        DIAGNOSTIC_EVENTS_KEY,
        LAST_PROXY_ERROR_KEY,
      ]);
      return { ok: true, message: "诊断记录已清除" };

    default:
      return { ok: false, error: "未知消息类型" };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (response: RuntimeResponse) => void,
  ) => {
    void handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        // 请求失败会通过响应显示到调用页面，不再制造 chrome://extensions 红色错误。
        void recordDiagnosticEvent({
          type: "background",
          message: `${message.type} 操作失败`,
          details: error instanceof Error ? error.message : String(error),
        });
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "后台操作失败",
        });
      });

    return true;
  },
);
