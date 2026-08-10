import {
  compileConfigRuntime,
  getActiveConfigProxyState,
  loadActiveConfigRuntime,
} from "../config/config-runtime.ts";
import {
  LAST_PROXY_ERROR_KEY,
} from "../shared/storage-keys.ts";
import { buildTargetedPacScript } from "./pac-builder.ts";
import {
  assertControllable,
  getDesiredEnabled,
  readEffectiveSetting,
  setDesiredEnabled,
  toProxyConfig,
  type ProxyConfig,
} from "./proxy-state.ts";

const MAX_RULES = 20_000;
const MAX_PAC_BYTES = 1_500_000;

export interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
  configured: boolean;
  proxyHost: string;
  proxyPort: number;
}

async function createPacConfig(): Promise<chrome.proxy.ProxyConfig> {
  const runtime = await loadActiveConfigRuntime();
  if (!runtime) throw new Error("请先在配置页保存并应用 YAML 配置");
  const compiled = compileConfigRuntime(runtime);
  if (compiled.rules.length > MAX_RULES) throw new Error(`有效规则数量 ${compiled.rules.length} 超过 ${MAX_RULES} 条限制`);
  const pac = buildTargetedPacScript(compiled.rules, compiled.proxies, compiled.fallbackTarget, compiled.providerHosts);
  const pacBytes = new TextEncoder().encode(pac).byteLength;
  if (pacBytes > MAX_PAC_BYTES) throw new Error(`PAC 大小 ${pacBytes} 字节超过 ${MAX_PAC_BYTES} 字节限制`);
  return { mode: "pac_script", pacScript: { data: pac, mandatory: true } };
}

async function applyPac(): Promise<void> {
  const previous = await chrome.proxy.settings.get({ incognito: false });
  assertControllable(previous.levelOfControl);
  const generated = await createPacConfig();
  try {
    await chrome.proxy.settings.set({ value: generated, scope: "regular" });
    const after = await readEffectiveSetting();
    if (after.mode !== "pac_script" || after.levelOfControl !== "controlled_by_this_extension") {
      throw new Error(`PAC 写入后未生效：${after.mode ?? "unknown"} / ${after.levelOfControl}`);
    }
    await chrome.storage.local.remove(LAST_PROXY_ERROR_KEY);
  } catch (error) {
    if (previous.levelOfControl === "controlled_by_this_extension") {
      await chrome.proxy.settings.set({ value: previous.value as chrome.proxy.ProxyConfig, scope: "regular" });
    } else {
      await chrome.proxy.settings.clear({ scope: "regular" });
    }
    throw error;
  }
}

export async function enableProxy(): Promise<ProxyConfig> {
  const state = await getActiveConfigProxyState();
  if (!state) throw new Error("请先在配置页保存并应用 YAML 配置");
  const config = toProxyConfig(state.activeProxy);
  await setDesiredEnabled(true);
  try {
    await applyPac();
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
}

export async function reconcileProxy(forceApply = false): Promise<boolean> {
  if (!(await getDesiredEnabled())) return false;
  if (!(await loadActiveConfigRuntime())) {
    await setDesiredEnabled(false);
    await chrome.proxy.settings.clear({ scope: "regular" });
    return true;
  }
  const current = await readEffectiveSetting();
  if (!forceApply && current.mode === "pac_script" && current.levelOfControl === "controlled_by_this_extension") return false;
  await applyPac();
  return true;
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const [effective, desiredEnabled, configState] = await Promise.all([
    readEffectiveSetting(),
    getDesiredEnabled(),
    getActiveConfigProxyState(),
  ]);
  const activeProxy = configState?.activeProxy;
  return {
    desiredEnabled,
    applied: desiredEnabled && effective.mode === "pac_script" && effective.levelOfControl === "controlled_by_this_extension",
    configured: Boolean(activeProxy),
    proxyHost: activeProxy?.host ?? "",
    proxyPort: activeProxy?.port ?? 0,
  };
}
