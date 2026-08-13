import { getProxyStatus } from "../proxy/pac-controller.ts";

const POPUP_PROXY_STATUS_CACHE_KEY = "popupProxyStatusCache";
let actionAppearanceEnabled: boolean | undefined;

async function cacheProxyStatus(
  status: Awaited<ReturnType<typeof getProxyStatus>>,
): Promise<void> {
  await chrome.storage.session.set({
    [POPUP_PROXY_STATUS_CACHE_KEY]: {
      status,
      updatedAt: Date.now(),
    },
  });
}

function iconPaths(active: boolean): Record<number, string> {
  const prefix = active ? "icon-active" : "icon";
  return {
    16: chrome.runtime.getURL(`icons/${prefix}-16.png`),
    32: chrome.runtime.getURL(`icons/${prefix}-32.png`),
  };
}

async function updateActionAppearance(engineEnabled: boolean): Promise<void> {
  if (actionAppearanceEnabled === engineEnabled) return;

  const path = iconPaths(engineEnabled);
  const title = engineEnabled
    ? "Auto Proxy：智能分流已启用"
    : "Auto Proxy：已关闭";

  await Promise.all([
    chrome.action.setIcon({ path }),
    chrome.action.setBadgeText({ text: "" }),
    chrome.action.setTitle({ title }),
  ]);

  // 覆盖旧版本留下的逐标签图标；后续不再随当前网页重新检测或切换。
  const tabs = await chrome.tabs.query({});
  const results = await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            chrome.action.setIcon({ tabId: tab.id, path }),
            chrome.action.setBadgeText({ tabId: tab.id, text: "" }),
            chrome.action.setTitle({ tabId: tab.id, title }),
          ],
    ),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Unable to update action appearance", result.reason);
    }
  }
  actionAppearanceEnabled = engineEnabled;
}

export async function syncActionState(): Promise<void> {
  const status = await getProxyStatus();
  await cacheProxyStatus(status);
  const engineEnabled = status.desiredEnabled && status.applied;
  await updateActionAppearance(engineEnabled);
}
