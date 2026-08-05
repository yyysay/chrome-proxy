import {
  BUILTIN_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../rule-packs/catalog";
import { compileRulePacks } from "../rule-packs/compiler";
import { buildPacScript } from "./pac-builder";

const PROXY_CONFIG_KEY = "proxyConfig";
const PROXY_STATE_KEY = "proxyState";
const PROXY_EVENT_KEY = "lastProxyEvent";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const LAST_PROXY_ERROR_KEY = "lastProxyError";
const FALLBACK_MODE_KEY = "fallbackMode";

export type FallbackMode = "direct" | "proxy" | "system";

export interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface StoredProxyState {
  desiredEnabled: boolean;
  updatedAt: string;
}

interface ProxyEvent {
  type: "enabled" | "disabled" | "restored" | "lost";
  reason: string;
  occurredAt: string;
  observedMode?: string;
  levelOfControl?: string;
}

export interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
  mode?: string;
  levelOfControl: string;
  fallbackMode: FallbackMode;
  proxyEndpoint?: string;
  lastEvent?: ProxyEvent;
  lastProxyError?: {
    error: string;
    details: string;
    fatal: boolean;
    occurredAt: string;
  };
}

function isValidProxyConfig(value: unknown): value is ProxyConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Partial<ProxyConfig>;

  return (
    config.type === "http" &&
    typeof config.host === "string" &&
    config.host.length > 0 &&
    typeof config.port === "number" &&
    Number.isInteger(config.port) &&
    config.port >= 1 &&
    config.port <= 65535
  );
}

async function loadProxyConfig(): Promise<ProxyConfig> {
  const stored = await chrome.storage.local.get(PROXY_CONFIG_KEY);
  const config = stored[PROXY_CONFIG_KEY] as unknown;

  if (!isValidProxyConfig(config)) {
    throw new Error("请先保存有效的本地 HTTP 代理配置");
  }

  return config;
}

async function getDesiredEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROXY_STATE_KEY);
  const state = stored[PROXY_STATE_KEY] as StoredProxyState | undefined;
  return state?.desiredEnabled === true;
}

async function setDesiredEnabled(desiredEnabled: boolean): Promise<void> {
  const state: StoredProxyState = {
    desiredEnabled,
    updatedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [PROXY_STATE_KEY]: state,
  });
}

async function recordProxyEvent(event: Omit<ProxyEvent, "occurredAt">): Promise<void> {
  await chrome.storage.local.set({
    [PROXY_EVENT_KEY]: {
      ...event,
      occurredAt: new Date().toISOString(),
    } satisfies ProxyEvent,
  });
}

async function loadEnabledRulePackIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(ENABLED_RULE_PACK_IDS_KEY);
  const value = stored[ENABLED_RULE_PACK_IDS_KEY] as unknown;

  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_RULE_PACK_IDS];
  }

  return value.filter((id): id is string => typeof id === "string");
}

async function loadFallbackMode(): Promise<FallbackMode> {
  const stored = await chrome.storage.local.get(FALLBACK_MODE_KEY);
  const value = stored[FALLBACK_MODE_KEY] as unknown;

  return value === "proxy" || value === "system" ? value : "direct";
}

async function createPacConfig(
  config: ProxyConfig,
): Promise<chrome.proxy.ProxyConfig> {
  const [enabledPackIds, fallbackMode] = await Promise.all([
    loadEnabledRulePackIds(),
    loadFallbackMode(),
  ]);
  const compiled = compileRulePacks(
    BUILTIN_RULE_PACKS,
    enabledPackIds,
    fallbackMode === "proxy" ? "PROXY" : "DIRECT",
  );

  if (compiled.issues.length > 0) {
    console.warn("规则包解析警告：", compiled.issues);
  }

  const pac = buildPacScript(compiled.rules, config);

  if (pac.warnings.length > 0) {
    console.warn("PAC 编译警告：", pac.warnings);
  }

  return {
    mode: "pac_script",
    pacScript: {
      data: pac.script,
      mandatory: true,
    },
  };
}

async function readEffectiveSetting(): Promise<{
  mode?: string;
  levelOfControl: string;
}> {
  const result = await chrome.proxy.settings.get({ incognito: false });
  const value = result.value as chrome.proxy.ProxyConfig | undefined;

  return {
    mode: value?.mode,
    levelOfControl: result.levelOfControl,
  };
}

function assertControllable(levelOfControl: string): void {
  if (
    levelOfControl !== "controllable_by_this_extension" &&
    levelOfControl !== "controlled_by_this_extension"
  ) {
    throw new Error(`当前代理设置不可由本扩展控制：${levelOfControl}`);
  }
}

async function applyPac(config: ProxyConfig): Promise<void> {
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  await chrome.proxy.settings.set({
    value: await createPacConfig(config),
    scope: "regular",
  });

  const after = await readEffectiveSetting();

  if (
    after.mode !== "pac_script" ||
    after.levelOfControl !== "controlled_by_this_extension"
  ) {
    throw new Error(
      `PAC 写入后未生效：${after.mode ?? "unknown"} / ${after.levelOfControl}`,
    );
  }

  await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
}

async function applySelectedMode(): Promise<void> {
  const fallbackMode = await loadFallbackMode();

  if (fallbackMode === "system") {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return;
  }

  await applyPac(await loadProxyConfig());
}

export async function enableTestProxy(): Promise<ProxyConfig> {
  const config = await loadProxyConfig();

  // 先保存用户意图。即使开发模式恰好在下一刻重新加载扩展，
  // 新 Service Worker 也能在 onInstalled 中恢复配置。
  await setDesiredEnabled(true);

  try {
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    await applySelectedMode();
    await recordProxyEvent({
      type: "enabled",
      reason: "user",
      observedMode: "pac_script",
      levelOfControl: "controlled_by_this_extension",
    });
  } catch (error) {
    await setDesiredEnabled(false);
    throw error;
  }

  return config;
}

export async function disableProxy(): Promise<void> {
  // onChange 监听器会看到 clear 事件；先关闭期望状态，避免误恢复。
  await setDesiredEnabled(false);
  await chrome.proxy.settings.clear({ scope: "regular" });
  await recordProxyEvent({ type: "disabled", reason: "user" });
}

export async function reconcileProxy(
  reason: string,
  forceApply = false,
): Promise<boolean> {
  if (!(await getDesiredEnabled())) {
    return false;
  }

  const [current, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    loadFallbackMode(),
  ]);

  if (fallbackMode === "system") {
    if (current.mode === "system") {
      return false;
    }

    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return true;
  }

  if (
    !forceApply &&
    current.mode === "pac_script" &&
    current.levelOfControl === "controlled_by_this_extension"
  ) {
    return false;
  }

  await recordProxyEvent({
    type: "lost",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });

  const config = await loadProxyConfig();
  await applyPac(config);
  await recordProxyEvent({
    type: "restored",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });

  return true;
}

export async function updateEnabledRulePacks(
  requestedIds: readonly string[],
): Promise<{
  enabledPackIds: string[];
  pacReapplied: boolean;
}> {
  const knownIds = new Set(BUILTIN_RULE_PACKS.map((pack) => pack.id));
  const enabledPackIds = requestedIds.filter((id) => knownIds.has(id));

  await chrome.storage.local.set({
    [ENABLED_RULE_PACK_IDS_KEY]: enabledPackIds,
  });

  const pacReapplied = await reconcileProxy("rulePacks.updated", true);

  return {
    enabledPackIds,
    pacReapplied,
  };
}

export async function updateFallbackMode(
  fallbackMode: FallbackMode,
): Promise<{ fallbackMode: FallbackMode; reapplied: boolean }> {
  await chrome.storage.local.set({
    [FALLBACK_MODE_KEY]: fallbackMode,
  });

  const reapplied = await reconcileProxy("fallbackMode.updated", true);
  return { fallbackMode, reapplied };
}

export async function beginProxyConnectivityCheck(): Promise<ProxyConfig> {
  const config = await loadProxyConfig();
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  const validationPac: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      mandatory: true,
      data: [
        "function FindProxyForURL(url, host) {",
        `  return ${JSON.stringify(`PROXY ${config.host}:${config.port}`)};`,
        "}",
      ].join("\n"),
    },
  };

  await chrome.proxy.settings.set({
    value: validationPac,
    scope: "regular",
  });

  return config;
}

export async function finishProxyConnectivityCheck(): Promise<void> {
  if (await getDesiredEnabled()) {
    await reconcileProxy("connectivityCheck.finished", true);
    return;
  }

  await chrome.proxy.settings.clear({ scope: "regular" });
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const [
    effective,
    desiredEnabled,
    stored,
    configStored,
    fallbackMode,
  ] = await Promise.all([
    readEffectiveSetting(),
    getDesiredEnabled(),
    chrome.storage.local.get([
      PROXY_EVENT_KEY,
      LAST_PROXY_ERROR_KEY,
    ]),
    chrome.storage.local.get(PROXY_CONFIG_KEY),
    loadFallbackMode(),
  ]);
  const config = configStored[PROXY_CONFIG_KEY] as unknown;

  return {
    desiredEnabled,
    applied: desiredEnabled && (
      fallbackMode === "system"
        ? effective.mode === "system"
        : effective.mode === "pac_script" &&
          effective.levelOfControl === "controlled_by_this_extension"
    ),
    mode: effective.mode,
    levelOfControl: effective.levelOfControl,
    fallbackMode,
    proxyEndpoint: isValidProxyConfig(config)
      ? `http://${config.host}:${config.port}`
      : undefined,
    lastEvent: stored[PROXY_EVENT_KEY] as ProxyEvent | undefined,
    lastProxyError: stored[LAST_PROXY_ERROR_KEY] as
      | {
          error: string;
          details: string;
          fatal: boolean;
          occurredAt: string;
        }
      | undefined,
  };
}
