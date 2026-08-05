import {
  beginProxyConnectivityCheck,
  disableProxy,
  enableTestProxy,
  finishProxyConnectivityCheck,
  getProxyStatus,
  reconcileProxy,
  updateEnabledRulePacks,
  updateFallbackMode,
} from "../proxy/proxy-manager";

const INSTALL_TIME_KEY = "installedAt";
const LAST_PROXY_ERROR_KEY = "lastProxyError";

type RuntimeMessage =
  | { type: "ENABLE_TEST_PROXY" }
  | { type: "DISABLE_PROXY" }
  | { type: "GET_PROXY_STATUS" }
  | { type: "UPDATE_RULE_PACKS"; enabledPackIds: string[] }
  | {
      type: "UPDATE_FALLBACK_MODE";
      fallbackMode: "direct" | "proxy" | "system";
    }
  | { type: "CHECK_PROXY_CONNECTIVITY" };

interface RuntimeResponse {
  ok: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

let reconcileTask: Promise<boolean> | undefined;
let forceReconcileQueued = false;

function scheduleReconcile(reason: string, forceApply = false): void {
  if (reconcileTask) {
    forceReconcileQueued ||= forceApply;
    return;
  }

  reconcileTask = reconcileProxy(reason, forceApply);

  void reconcileTask
    .catch((error: unknown) => {
      console.error(`代理状态同步失败（${reason}）：`, error);
    })
    .finally(() => {
      reconcileTask = undefined;

      if (forceReconcileQueued) {
        forceReconcileQueued = false;
        scheduleReconcile("proxyConfig.queuedChange", true);
      }
    });
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
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
  })().catch((error: unknown) => {
    console.error("扩展初始化失败：", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleReconcile("runtime.startup");
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

  // console.error 会让 chrome://extensions 把这条诊断信息显示为扩展错误。
  // 将它持久化给 Popup 展示，同时保留普通警告日志。
  void chrome.storage.local.set({
    [LAST_PROXY_ERROR_KEY]: errorRecord,
  });
  console.warn("Chrome 代理连接异常：", errorRecord);
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
      return {
        ok: true,
        message: `测试分流已启用：http://${config.host}:${config.port}`,
      };
    }

    case "DISABLE_PROXY":
      await disableProxy();
      return { ok: true, message: "扩展代理设置已关闭" };

    case "GET_PROXY_STATUS":
      return { ok: true, data: await getProxyStatus() };

    case "UPDATE_RULE_PACKS": {
      const result = await updateEnabledRulePacks(message.enabledPackIds);
      return {
        ok: true,
        data: result,
        message: result.pacReapplied
          ? "规则包已保存，PAC 已重新应用"
          : "规则包已保存；分流未开启，暂不应用 PAC",
      };
    }

    case "UPDATE_FALLBACK_MODE": {
      const result = await updateFallbackMode(message.fallbackMode);
      return {
        ok: true,
        data: result,
        message: message.fallbackMode === "system"
          ? "已交还系统代理；规则包分流暂停"
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
        console.error(error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "后台操作失败",
        });
      });

    return true;
  },
);
