import { getProxyStatus } from "../proxy/proxy-manager.ts";

function iconPaths(active: boolean): Record<number, string> {
  const prefix = active ? "icon-active" : "icon";

  return {
    16: chrome.runtime.getURL(`icons/${prefix}-16.png`),
    32: chrome.runtime.getURL(`icons/${prefix}-32.png`),
  };
}

export async function syncActionState(): Promise<void> {
  const status = await getProxyStatus();
  const active = status.desiredEnabled || status.applied;

  const results = await Promise.allSettled([
    chrome.action.setIcon({
      path: iconPaths(active),
    }),
    chrome.action.setBadgeText({ text: "" }),
    chrome.action.setTitle({
      title: active ? "Auto Proxy：已开启" : "Auto Proxy：已关闭",
    }),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Unable to update action appearance", result.reason);
    }
  }

  console.info("Action state synchronized", {
    active,
    icon: iconPaths(active),
  });
}