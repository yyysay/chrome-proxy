import {
  beginNetworkInfoCheck,
  beginProxyConnectivityCheck,
  disableProxy,
  enableTestProxy,
  finishProxyConnectivityCheck,
  getRulePackSettings,
  getProxyStatus,
  reconcileProxy,
  updateEnabledRulePacks,
  updateSimpleEnabledRulePacks,
  updateUiMode,
  updateFallbackMode,
  saveRulePack,
  refreshRulePack,
  deleteRulePack,
  refreshEnabledRulePacks,
  migrateStoredData,
  testRuleMatch,
} from "../proxy/proxy-manager";

const INSTALL_TIME_KEY = "installedAt";
const LAST_PROXY_ERROR_KEY = "lastProxyError";
const DIAGNOSTIC_EVENTS_KEY = "diagnosticEvents";
const RULE_REFRESH_ALARM = "refresh-enabled-rules";
const AUTO_REFRESH_ENABLED_KEY = "autoRuleRefreshEnabled";
const AUTO_REFRESH_INTERVAL_KEY = "autoRuleRefreshIntervalHours";
const ALLOWED_REFRESH_INTERVAL_HOURS = new Set([6, 12, 24, 168]);
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
  | { type: "UPDATE_SIMPLE_RULE_PACKS"; enabledPackIds: string[] }
  | { type: "UPDATE_UI_MODE"; mode: "simple" | "expert" }
  | {
      type: "UPDATE_FALLBACK_MODE";
      fallbackMode: "direct" | "proxy" | "system";
    }
  | { type: "CHECK_PROXY_CONNECTIVITY" }
  | { type: "GET_NETWORK_INFO" }
  | { type: "GET_RULE_PACK_SETTINGS" }
  | { type: "REFRESH_RULE_PACK"; packId: string }
  | {
      type: "SAVE_RULE_PACK";
      packId?: string;
      name: string;
      url: string;
      action: "DIRECT" | "PROXY";
      customContent: string;
      sourceStrategy: "local-first" | "subscription-first" | "merge";
    }
  | { type: "DELETE_RULE_PACK"; packId: string }
  | {
      type: "UPDATE_RULE_AUTO_REFRESH";
      enabled: boolean;
      intervalHours: number;
    }
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
let proxyProbeQueue: Promise<void> = Promise.resolve();

interface NetworkGeoInfo {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  asn?: number;
}

interface NetworkRouteInfo extends NetworkGeoInfo {
  ip: string;
  requestMs: number;
}

function runExclusiveProxyProbe<T>(task: () => Promise<T>): Promise<T> {
  const run = proxyProbeQueue.then(task, task);
  proxyProbeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function isLikelyIp(value: string): boolean {
  return value.length > 0 && value.length <= 45 && /^[0-9a-f:.]+$/i.test(value);
}

function parseIpipCurrentInfo(text: string, requestMs: number): NetworkRouteInfo {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:IP|ip)\s*[：:]?\s*([0-9a-f:.]+)(?:\s+来自于[：:]?\s*(.*))?/);
  const ip = match?.[1]?.trim() ?? "";

  if (!isLikelyIp(ip)) {
    throw new Error("IPIP 未返回有效的直连出口 IP");
  }

  const location = match?.[2]?.trim();
  const parts = location ? location.split(/\s+/).filter(Boolean) : [];
  const country = parts[0];

  return {
    ip,
    requestMs,
    country,
    countryCode: country === "中国" ? "CN" : undefined,
    region: parts[1],
    city: parts[2],
    isp: parts.length > 3 ? parts.slice(3).join(" ") : undefined,
  };
}

function parseIpSbGeo(value: Record<string, unknown>, requestMs: number): NetworkRouteInfo {
  const ip = typeof value.ip === "string" ? value.ip.trim() : "";
  if (!isLikelyIp(ip)) {
    throw new Error("IP.SB 未返回有效的代理出口 IP");
  }

  return {
    ip,
    requestMs,
    country: typeof value.country === "string" ? value.country : undefined,
    countryCode: typeof value.country_code === "string" ? value.country_code.toUpperCase() : undefined,
    region: typeof value.region === "string" ? value.region : undefined,
    city: typeof value.city === "string" ? value.city : undefined,
    isp: typeof value.isp === "string" ? value.isp : undefined,
    asn: typeof value.asn === "number" ? value.asn : undefined,
  };
}

interface RuleAutoRefreshSettings {
  enabled: boolean;
  intervalHours: number;
}

function normalizeRefreshIntervalHours(value: unknown): number {
  const intervalHours = Number(value);
  return ALLOWED_REFRESH_INTERVAL_HOURS.has(intervalHours) ? intervalHours : 24;
}

async function loadRuleAutoRefreshSettings(): Promise<RuleAutoRefreshSettings> {
  const stored = await chrome.storage.local.get([
    AUTO_REFRESH_ENABLED_KEY,
    AUTO_REFRESH_INTERVAL_KEY,
  ]);

  return {
    enabled: stored[AUTO_REFRESH_ENABLED_KEY] === true,
    intervalHours: normalizeRefreshIntervalHours(stored[AUTO_REFRESH_INTERVAL_KEY]),
  };
}

async function syncRuleRefreshAlarm(): Promise<RuleAutoRefreshSettings> {
  const settings = await loadRuleAutoRefreshSettings();

  if (!settings.enabled) {
    await chrome.alarms.clear(RULE_REFRESH_ALARM);
    return settings;
  }

  await chrome.alarms.create(RULE_REFRESH_ALARM, {
    periodInMinutes: settings.intervalHours * 60,
  });
  return settings;
}

async function updateRuleAutoRefreshSettings(
  enabled: boolean,
  intervalHours: number,
): Promise<RuleAutoRefreshSettings> {
  const normalizedInterval = normalizeRefreshIntervalHours(intervalHours);

  if (enabled && !ALLOWED_REFRESH_INTERVAL_HOURS.has(Number(intervalHours))) {
    throw new Error("自动更新间隔无效");
  }

  await chrome.storage.local.set({
    [AUTO_REFRESH_ENABLED_KEY]: enabled,
    [AUTO_REFRESH_INTERVAL_KEY]: normalizedInterval,
  });

  return syncRuleRefreshAlarm();
}

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
    await syncRuleRefreshAlarm();
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
  void (async () => {
    await migrateStoredData();
    await syncRuleRefreshAlarm();
    scheduleReconcile("runtime.startup");
    await syncActionState();
  })().catch((error: unknown) => {
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

  void (async () => {
    const settings = await loadRuleAutoRefreshSettings();
    if (!settings.enabled) {
      await chrome.alarms.clear(RULE_REFRESH_ALARM);
      return;
    }

    const result = await refreshEnabledRulePacks();
    if (result.cached > 0) {
      await recordDiagnosticEvent({
        type: "subscription",
        message: "部分规则自动更新失败，已继续使用现有规则",
        details: `回退到现有规则 ${result.cached} 个`,
      });
    }
  })().catch((error: unknown) => {
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

    case "UPDATE_SIMPLE_RULE_PACKS": {
      const result = await updateSimpleEnabledRulePacks(message.enabledPackIds);
      return {
        ok: true,
        data: result,
        message: result.pacReapplied
          ? "简易规则已更新，PAC 已重新应用"
          : "简易规则已保存",
      };
    }

    case "UPDATE_UI_MODE": {
      const result = await updateUiMode(message.mode);
      await syncActionState();
      return {
        ok: true,
        data: result,
        message: message.mode === "simple"
          ? "已切换到简易模式，仅预设网站走代理"
          : "已切换到高级模式，恢复高级规则配置",
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

    case "CHECK_PROXY_CONNECTIVITY":
      return runExclusiveProxyProbe(async () => {
        const config = await beginProxyConnectivityCheck();

        try {
          // 这里只测“通过代理完成一次 HTTP 请求”的耗时，不代表下载带宽。
          const requestStartedAt = performance.now();
          const url = `https://ip125.com/?proxy-connectivity-check=${Date.now()}`;
          const response = await fetch(url, {
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          });

          if (!response.ok) {
            throw new Error(`IP125 返回 HTTP ${response.status}`);
          }

          await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
          const requestMs = Math.max(1, Math.round(performance.now() - requestStartedAt));

          return {
            ok: true,
            data: {
              endpoint: `http://${config.host}:${config.port}`,
              requestMs,
              // 兼容旧前端字段；语义同样是请求耗时，不是“测速”。
              latencyMs: requestMs,
            },
            message: `局域网代理连接正常：http://${config.host}:${config.port}`,
          };
        } finally {
          await finishProxyConnectivityCheck();
        }
      });

    case "GET_NETWORK_INFO":
      return runExclusiveProxyProbe(async () => {
        const config = await beginNetworkInfoCheck();
        let directResult: PromiseSettledResult<NetworkRouteInfo>;
        let proxyResult: PromiseSettledResult<NetworkRouteInfo>;

        try {
          // 只发两次并行请求：IPIP 的响应本身带直连归属地；
          // IP.SB /geoip 一次返回代理出口 IP + GeoIP，避免旧版拿到 IP 后再二次查询。
          const directStartedAt = performance.now();
          const directRequest = fetch(`https://myip.ipip.net/?t=${Date.now()}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          }).then(async (response) => {
            if (!response.ok) {
              throw new Error(`IPIP 返回 HTTP ${response.status}`);
            }
            const text = await response.text();
            const requestMs = Math.max(1, Math.round(performance.now() - directStartedAt));
            return parseIpipCurrentInfo(text, requestMs);
          });

          const proxyStartedAt = performance.now();
          const proxyRequest = fetch(`https://api.ip.sb/geoip?t=${Date.now()}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          }).then(async (response) => {
            if (!response.ok) {
              throw new Error(`IP.SB 返回 HTTP ${response.status}`);
            }
            const value = await response.json() as Record<string, unknown>;
            const requestMs = Math.max(1, Math.round(performance.now() - proxyStartedAt));
            return parseIpSbGeo(value, requestMs);
          });

          [directResult, proxyResult] = await Promise.allSettled([directRequest, proxyRequest]);
        } finally {
          // 网络信息探测期间使用临时 PAC；无论成功失败都恢复用户原来的代理状态。
          await finishProxyConnectivityCheck();
        }

        const direct = directResult.status === "fulfilled" ? directResult.value : undefined;
        const proxy = proxyResult.status === "fulfilled" ? proxyResult.value : undefined;
        const directError = directResult.status === "rejected"
          ? (directResult.reason instanceof Error ? directResult.reason.message : String(directResult.reason))
          : undefined;
        const proxyError = proxyResult.status === "rejected"
          ? (proxyResult.reason instanceof Error ? proxyResult.reason.message : String(proxyResult.reason))
          : undefined;

        // 即使两个探测都失败，也把各自错误返回给设置页。
        // “两个 API 都失败”不等同于可以断言设备完全无网络。
        const sameExitIp = Boolean(direct && proxy && direct.ip === proxy.ip);

        return {
          ok: true,
          data: {
            proxyEndpoint: `http://${config.host}:${config.port}`,
            direct,
            proxy,
            directError,
            proxyError,
            sameExitIp,
          },
          message: direct && proxy
            ? sameExitIp
              ? "网络信息已更新；直连与代理出口 IP 相同"
              : "网络信息已更新；代理出口已与本地直连区分"
            : direct || proxy
              ? "网络信息已部分更新"
              : "网络信息获取失败",
        };
      });

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
        message.intervalHours,
      );
      return {
        ok: true,
        data: settings,
        message: settings.enabled
          ? `自动更新已开启：每 ${settings.intervalHours} 小时`
          : "自动更新已关闭",
      };
    }

    case "TEST_RULE_MATCH":
      return { ok: true, data: await testRuleMatch(message.input) };

    case "REFRESH_ENABLED_RULE_PACKS": {
      const result = await refreshEnabledRulePacks();
      if (result.cached > 0) {
        void recordDiagnosticEvent({
          type: "subscription",
          message: "部分规则更新失败，已继续使用现有规则",
          details: `回退到现有规则 ${result.cached} 个`,
        });
      }
      return {
        ok: true,
        data: result,
        message: `更新完成：成功 ${result.refreshed}，回退 ${result.cached}，无订阅 ${result.skipped}`,
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
