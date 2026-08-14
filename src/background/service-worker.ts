import { migrateStoredData } from "../proxy/storage-migration.ts";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";
import { INSTALL_TIME_KEY } from "../shared/storage-keys.ts";
import { removeTabActionState, syncActionState } from "./action-state.ts";
import {
  handleRefreshAlarm,
} from "./alarms.ts";
import {
  recordDiagnosticEvent,
  recordProxyError,
} from "./diagnostics.ts";
import { handleMessage } from "./message-handler.ts";
import { scheduleReconcile } from "./reconcile-scheduler.ts";
import { syncConfigRefreshAlarms } from "../config/config-runtime.ts";
import { recordTabRequestRoute, removeTabRequestRouteState } from "./request-route-state.ts";

async function initializeExtension(reason: string): Promise<void> {
  await migrateStoredData();
  await syncConfigRefreshAlarms();
  const stored = await chrome.storage.local.get(INSTALL_TIME_KEY);

  if (!stored[INSTALL_TIME_KEY]) {
    await chrome.storage.local.set({
      [INSTALL_TIME_KEY]: new Date().toISOString(),
    });
  }

  if (reason === "install") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html"),
    });
  }

  // 开发模式更新 dist 后，Chrome 会重新加载扩展并清除它控制的设置。
  // onInstalled 在重新加载完成后触发，此时再根据持久状态恢复 PAC。
  scheduleReconcile(`runtime.${reason}`);
  // storage.session 可能保留旧缓存，但扩展重载会清除 tab 级 action 覆盖，必须强制恢复。
  await syncActionState(undefined, undefined, true);
}

async function restoreExtensionOnStartup(): Promise<void> {
  await migrateStoredData();
  await syncConfigRefreshAlarms();
  scheduleReconcile("runtime.startup");
  await syncActionState(undefined, undefined, true);
}

chrome.runtime.onInstalled.addListener((details) => {
  void initializeExtension(details.reason).catch((error: unknown) => {
    void recordDiagnosticEvent({
      type: "background",
      message: "扩展初始化失败",
      details: error instanceof Error ? error.message : String(error),
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  void restoreExtensionOnStartup().catch((error: unknown) => {
    void recordDiagnosticEvent({
      type: "background",
      message: "扩展启动迁移失败",
      details: error instanceof Error ? error.message : String(error),
    });
  });
});

chrome.alarms.onAlarm.addListener(handleRefreshAlarm);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    recordTabRequestRoute(details);
    if (details.type === "main_frame" && details.tabId >= 0) {
      // 比 tabs.onUpdated 更早写入 icon 与 popup 首帧状态，避免导航后短暂沿用上一页。
      void syncActionState(details.tabId, details.url).catch(() => undefined);
    }
    return undefined;
  },
  { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
);

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncActionState(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    // Chrome 在同 URL 刷新时可能重置 tab 级 action 覆盖；complete 阶段必须重新写入。
    void syncActionState(tabId, changeInfo.url, changeInfo.status === "complete").catch(() => undefined);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void Promise.all([
    removeTabActionState(tabId),
    removeTabRequestRouteState(tabId),
  ]).catch(() => undefined);
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

chrome.proxy.onProxyError.addListener(recordProxyError);

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
