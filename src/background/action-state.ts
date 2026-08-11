import { testConfigRuleMatch } from "../config/config-service.ts";
import { getProxyStatus } from "../proxy/pac-controller.ts";

function iconPaths(active: boolean): Record<number, string> {
  const prefix = active ? "icon-active" : "icon";
  return {
    16: chrome.runtime.getURL(`icons/${prefix}-16.png`),
    32: chrome.runtime.getURL(`icons/${prefix}-32.png`),
  };
}

async function updateTab(tab: chrome.tabs.Tab, engineEnabled: boolean): Promise<void> {
  let active = false;
  let title = engineEnabled ? "Auto Proxy：当前页面直连" : "Auto Proxy：已关闭";
  if (engineEnabled && tab.url && /^https?:/i.test(tab.url)) {
    try {
      const route = await testConfigRuleMatch(tab.url);
      active = route.action !== "DIRECT";
      title = active
        ? `Auto Proxy：当前页面经 ${route.action} 代理`
        : "Auto Proxy：当前页面直连";
    } catch {
      title = "Auto Proxy：无法判断当前页面";
    }
  }
  await Promise.all([
    chrome.action.setIcon({ tabId: tab.id, path: iconPaths(active) }),
    chrome.action.setBadgeText({ tabId: tab.id, text: "" }),
    chrome.action.setTitle({ tabId: tab.id, title }),
  ]);
}

export async function syncActionState(tabId?: number, url?: string): Promise<void> {
  const status = await getProxyStatus();
  const engineEnabled = status.desiredEnabled && status.applied;
  let tabs: chrome.tabs.Tab[];
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      tabs = [{ ...tab, url: url ?? tab.url }];
    } catch {
      return;
    }
  } else {
    tabs = await chrome.tabs.query({});
  }
  const results = await Promise.allSettled(tabs.filter((tab) => tab.id !== undefined)
    .map((tab) => updateTab(tab, engineEnabled)));
  for (const result of results) {
    if (result.status === "rejected") console.warn("Unable to update action appearance", result.reason);
  }
}
