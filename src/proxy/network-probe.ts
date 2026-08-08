import { getEffectiveProxy } from "./proxy-provider.ts";
import { reconcileProxy } from "./pac-controller.ts";
import {
  assertControllable,
  getDesiredEnabled,
  readEffectiveSetting,
  toProxyConfig,
  type ProxyConfig,
} from "./proxy-state.ts";

export async function beginNetworkInfoCheck(): Promise<ProxyConfig> {
  const config = toProxyConfig(await getEffectiveProxy());
  const before = await readEffectiveSetting();
  assertControllable(before.levelOfControl);

  const probePac: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      mandatory: true,
      data: [
        "function FindProxyForURL(url, host) {",
        '  if (host === "myip.ipip.net") return "DIRECT";',
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
    await reconcileProxy("networkInfoCheck.finished", true);
    return;
  }
  await chrome.proxy.settings.clear({ scope: "regular" });
}
