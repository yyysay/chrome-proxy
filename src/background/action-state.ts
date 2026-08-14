import { testConfigRuleMatch } from "../config/config-service.ts";
import { getProxyStatus } from "../proxy/pac-controller.ts";
import type { ActiveSiteProxyStatus } from "../shared/runtime-protocol.ts";

const TAB_ACTION_STATE_PREFIX = "tab-action-state:";

function tabActionStateKey(tabId: number): string {
  return `${TAB_ACTION_STATE_PREFIX}${tabId}`;
}

function iconPaths(active: boolean): Record<number, string> {
  const prefix = active ? "icon-active" : "icon";
  return {
    16: chrome.runtime.getURL(`icons/${prefix}-16.png`),
    32: chrome.runtime.getURL(`icons/${prefix}-32.png`),
  };
}

async function updateTab(tab: chrome.tabs.Tab, engineEnabled: boolean): Promise<ActiveSiteProxyStatus | undefined> {
  if (tab.id === undefined) return undefined;
  const url = tab.url ?? "";
  let hostname = tab.title || "浏览器内部页面";
  let action = "不可用";
  let active = false;
  let title = engineEnabled ? "Auto Proxy：当前页面直连" : "Auto Proxy：已关闭";
  if (/^https?:/i.test(url)) {
    hostname = new URL(url).hostname;
    if (engineEnabled) {
      try {
        const route = await testConfigRuleMatch(url);
        action = route.action;
        active = route.action !== "DIRECT";
        title = active
          ? `Auto Proxy：当前页面经 ${route.action} 代理`
          : "Auto Proxy：当前页面直连";
      } catch (error) {
        action = error instanceof Error && error.message.includes("请先") ? "未配置" : "未知";
        title = "Auto Proxy：无法判断当前页面";
      }
    } else {
      action = "已关闭";
    }
  }
  const state: ActiveSiteProxyStatus = {
    tabId: tab.id,
    url,
    hostname,
    action,
    proxied: active,
    engineEnabled,
  };
  const key = tabActionStateKey(tab.id);
  const stored = await chrome.storage.session.get(key);
  const previous = stored[key] as ActiveSiteProxyStatus | undefined;
  const updates: Promise<unknown>[] = [chrome.storage.session.set({ [key]: state })];
  if (!previous || previous.proxied !== state.proxied) {
    updates.push(
      chrome.action.setIcon({ tabId: tab.id, path: iconPaths(active) }),
      chrome.action.setPopup({ tabId: tab.id, popup: `popup.html?proxied=${active ? "1" : "0"}` }),
    );
  }
  if (!previous || previous.action !== state.action || previous.engineEnabled !== state.engineEnabled) {
    updates.push(chrome.action.setTitle({ tabId: tab.id, title }));
  }
  if (!previous) updates.push(chrome.action.setBadgeText({ tabId: tab.id, text: "" }));
  await Promise.all(updates);
  return state;
}

export async function getActiveTabActionState(): Promise<ActiveSiteProxyStatus | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return undefined;
  const key = tabActionStateKey(tab.id);
  const stored = await chrome.storage.session.get(key);
  const cached = stored[key] as ActiveSiteProxyStatus | undefined;
  if (cached?.url === (tab.url ?? "")) return cached;
  const status = await getProxyStatus();
  return updateTab(tab, status.desiredEnabled && status.applied);
}

export async function removeTabActionState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(tabActionStateKey(tabId));
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
