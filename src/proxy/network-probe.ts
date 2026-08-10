import { getActiveConfigProxyState } from "../config/config-runtime.ts";
import { reconcileProxy } from "./pac-controller.ts";
import {
  assertControllable,
  getDesiredEnabled,
  readEffectiveSetting,
  toProxyConfig,
  type ProxyConfig,
} from "./proxy-state.ts";

export async function beginNetworkInfoCheck(nodeName?: string): Promise<ProxyConfig> {
  const state = await getActiveConfigProxyState(nodeName);
  if (!state) throw new Error("请先保存并应用 YAML 配置");
  const config = toProxyConfig(state.activeProxy);
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  const probePac: chrome.proxy.ProxyConfig = {
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
  await chrome.proxy.settings.set({ value: probePac, scope: "regular" });
  return config;
}

export async function finishNetworkInfoCheck(): Promise<void> {
  if (await getDesiredEnabled()) {
    await reconcileProxy(true);
    return;
  }
  await chrome.proxy.settings.clear({ scope: "regular" });
}
