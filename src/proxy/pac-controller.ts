import { compileRulePacks } from "../rule-packs/compiler.ts";
import {
  loadActiveEnabledRulePackIds,
  loadRuntimeCatalog,
  managedRuleSourceHosts,
} from "../rule-packs/repository.ts";
import type { FallbackMode } from "../shared/runtime-protocol.ts";
import {
  FALLBACK_MODE_KEY,
  LAST_PROXY_ERROR_KEY,
  PROXY_EVENT_KEY,
  RULE_ENGINE_STATUS_KEY,
} from "../shared/storage-keys.ts";
import { buildPacScript } from "./pac-builder.ts";
import {
  getEffectiveProxy,
  getProxyProviderState,
  refreshProxySubscription,
  type EffectiveProxySource,
} from "./proxy-provider.ts";
import {
  assertControllable,
  getDesiredEnabled,
  loadFallbackMode,
  proxyEndpoint,
  readEffectiveSetting,
  recordProxyEvent,
  setDesiredEnabled,
  toProxyConfig,
  type ProxyConfig,
  type ProxyEvent,
} from "./proxy-state.ts";

const MAX_RULES = 20_000;
const MAX_PAC_BYTES = 1_500_000;

export interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
  mode?: string;
  levelOfControl: string;
  proxyEndpoint: string;
  proxyHost: string;
  proxyPort: number;
  proxyName: string;
  proxyNodeId: string;
  proxySource: EffectiveProxySource;
  fallbackMode: FallbackMode;
  lastEvent?: ProxyEvent;
  lastProxyError?: {
    error: string;
    details: string;
    fatal: boolean;
    occurredAt: string;
  };
  ruleEngineStatus?: {
    statistics: {
      parsed: number;
      effective: number;
      duplicates: number;
      conflicts: number;
      issues: number;
    };
    pacBytes: number;
    generatedAt: string;
  };
}

async function createPacConfig(config: ProxyConfig): Promise<{
  config: chrome.proxy.ProxyConfig;
  report: {
    statistics: ReturnType<typeof compileRulePacks>["statistics"];
    conflicts: ReturnType<typeof compileRulePacks>["conflicts"];
    pacBytes: number;
    generatedAt: string;
  };
}> {
  const [enabledPackIds, fallbackMode, runtimeCatalog] = await Promise.all([
    loadActiveEnabledRulePackIds(),
    loadFallbackMode(),
    loadRuntimeCatalog(),
  ]);
  const compiled = compileRulePacks(runtimeCatalog, enabledPackIds);
  if (compiled.rules.length > MAX_RULES) {
    throw new Error(`有效规则数量 ${compiled.rules.length} 超过 ${MAX_RULES} 条限制`);
  }

  const pac = buildPacScript(
    compiled.rules,
    config,
    fallbackMode === "proxy" ? "PROXY" : "DIRECT",
    managedRuleSourceHosts(runtimeCatalog),
  );
  const pacBytes = new TextEncoder().encode(pac.script).byteLength;
  if (pacBytes > MAX_PAC_BYTES) {
    throw new Error(`PAC 大小 ${pacBytes} 字节超过 ${MAX_PAC_BYTES} 字节限制`);
  }

  return {
    config: {
      mode: "pac_script",
      pacScript: { data: pac.script, mandatory: true },
    },
    report: {
      statistics: compiled.statistics,
      conflicts: compiled.conflicts,
      pacBytes,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function applyPac(config: ProxyConfig): Promise<void> {
  const previous = await chrome.proxy.settings.get({ incognito: false });
  const before = {
    mode: (previous.value as chrome.proxy.ProxyConfig | undefined)?.mode,
    levelOfControl: previous.levelOfControl,
  };
  assertControllable(before.levelOfControl);
  const generated = await createPacConfig(config);

  try {
    await chrome.proxy.settings.set({ value: generated.config, scope: "regular" });
    const after = await readEffectiveSetting();
    if (after.mode !== "pac_script" || after.levelOfControl !== "controlled_by_this_extension") {
      throw new Error(`PAC 写入后未生效：${after.mode ?? "unknown"} / ${after.levelOfControl}`);
    }
    await chrome.storage.local.set({ [RULE_ENGINE_STATUS_KEY]: generated.report });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  } catch (error) {
    if (previous.levelOfControl === "controlled_by_this_extension") {
      await chrome.proxy.settings.set({
        value: previous.value as chrome.proxy.ProxyConfig,
        scope: "regular",
      });
    } else {
      await chrome.proxy.settings.clear({ scope: "regular" });
    }
    throw error;
  }
}

export async function applySelectedMode(): Promise<void> {
  const fallbackMode = await loadFallbackMode();
  if (fallbackMode === "system") {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return;
  }
  await applyPac(toProxyConfig(await getEffectiveProxy()));
}

async function maybeBootstrapProxySubscription(): Promise<void> {
  const state = await getProxyProviderState();
  if (state.sourceMode !== "subscription" || !state.subscriptionUrl ||
      state.effectiveSource === "subscription") return;
  await refreshProxySubscription().catch(() => undefined);
}

export async function enableProxy(): Promise<ProxyConfig> {
  await maybeBootstrapProxySubscription();
  const config = toProxyConfig(await getEffectiveProxy());
  await setDesiredEnabled(true);
  try {
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    await applySelectedMode();
    const fallbackMode = await loadFallbackMode();
    await recordProxyEvent({
      type: "enabled",
      reason: "user",
      observedMode: fallbackMode === "system" ? "system" : "pac_script",
      levelOfControl: fallbackMode === "system" ? "system" : "controlled_by_this_extension",
    });
  } catch (error) {
    await setDesiredEnabled(false);
    throw error;
  }
  return config;
}

export async function disableProxy(): Promise<void> {
  await setDesiredEnabled(false);
  await chrome.proxy.settings.clear({ scope: "regular" });
  await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  await recordProxyEvent({ type: "disabled", reason: "user" });
}

export async function reconcileProxy(reason: string, forceApply = false): Promise<boolean> {
  if (!(await getDesiredEnabled())) return false;
  const [current, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    loadFallbackMode(),
  ]);

  if (fallbackMode === "system") {
    if (!forceApply && current.mode === "system") return false;
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
    return true;
  }

  if (!forceApply && current.mode === "pac_script" &&
      current.levelOfControl === "controlled_by_this_extension") return false;

  await recordProxyEvent({
    type: "lost",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });
  await applySelectedMode();
  await recordProxyEvent({
    type: "restored",
    reason,
    observedMode: current.mode,
    levelOfControl: current.levelOfControl,
  });
  return true;
}

export async function updateFallbackMode(
  fallbackMode: FallbackMode,
): Promise<{ fallbackMode: FallbackMode; reapplied: boolean }> {
  if (fallbackMode !== "direct" && fallbackMode !== "proxy" && fallbackMode !== "system") {
    throw new Error("MATCH 策略无效");
  }
  const previous = await loadFallbackMode();
  await chrome.storage.local.set({ [FALLBACK_MODE_KEY]: fallbackMode });
  try {
    const reapplied = await reconcileProxy("fallbackMode.updated", true);
    return { fallbackMode, reapplied };
  } catch (error) {
    await chrome.storage.local.set({ [FALLBACK_MODE_KEY]: previous });
    throw error;
  }
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const [effective, desiredEnabled, stored, provider, fallbackMode] = await Promise.all([
    readEffectiveSetting(),
    getDesiredEnabled(),
    chrome.storage.local.get([PROXY_EVENT_KEY, LAST_PROXY_ERROR_KEY, RULE_ENGINE_STATUS_KEY]),
    getProxyProviderState(),
    loadFallbackMode(),
  ]);

  return {
    desiredEnabled,
    applied: desiredEnabled && (fallbackMode === "system"
      ? effective.mode === "system"
      : effective.mode === "pac_script" && effective.levelOfControl === "controlled_by_this_extension"),
    mode: effective.mode,
    levelOfControl: effective.levelOfControl,
    proxyEndpoint: proxyEndpoint(provider.activeProxy),
    proxyHost: provider.activeProxy.host,
    proxyPort: provider.activeProxy.port,
    proxyName: provider.activeProxy.name,
    proxyNodeId: provider.activeProxy.id,
    proxySource: provider.effectiveSource,
    fallbackMode,
    lastEvent: stored[PROXY_EVENT_KEY] as ProxyEvent | undefined,
    lastProxyError: stored[LAST_PROXY_ERROR_KEY] as ProxyStatus["lastProxyError"],
    ruleEngineStatus: stored[RULE_ENGINE_STATUS_KEY] as ProxyStatus["ruleEngineStatus"],
  };
}
