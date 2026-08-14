import { testConfigRuleMatch } from "../config/config-service.ts";
import { getProxyStatus } from "../proxy/pac-controller.ts";
import type { ActiveTabRequestRoutes, TabRequestRouteGroup } from "../shared/runtime-protocol.ts";
import { TAB_REQUEST_ROUTE_STATE_PREFIX } from "../shared/storage-keys.ts";

interface TabRequestRouteRecord {
  hostname: string;
  action: string;
  proxied: boolean;
}

interface TabRequestRouteState {
  tabId: number;
  pageUrl: string;
  pageHostname: string;
  records: TabRequestRouteRecord[];
}

interface RequestRouteInput {
  tabId: number;
  url: string;
  type: string;
}

const tabQueues = new Map<number, Promise<void>>();

function stateKey(tabId: number): string {
  return `${TAB_REQUEST_ROUTE_STATE_PREFIX}${tabId}`;
}

function requestHostname(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) ? url.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function groupRecords(records: readonly TabRequestRouteRecord[]): TabRequestRouteGroup[] {
  const groups = new Map<string, TabRequestRouteGroup>();
  for (const record of records) {
    let group = groups.get(record.action);
    if (!group) {
      group = { action: record.action, proxied: record.proxied, domains: [] };
      groups.set(record.action, group);
    }
    group.domains.push(record.hostname);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.proxied !== right.proxied) return left.proxied ? -1 : 1;
    return right.domains.length - left.domains.length;
  });
}

async function currentEngineEnabled(): Promise<boolean> {
  const status = await getProxyStatus();
  return status.desiredEnabled && status.applied;
}

async function writeRequestRoute(input: RequestRouteInput): Promise<void> {
  const hostname = requestHostname(input.url);
  if (!hostname) return;
  const key = stateKey(input.tabId);
  const stored = await chrome.storage.session.get(key);
  const previous = stored[key] as TabRequestRouteState | undefined;
  const mainFrame = input.type === "main_frame";
  const pageUrl = mainFrame ? input.url : previous?.pageUrl ?? "";
  const pageHostname = mainFrame ? hostname : previous?.pageHostname ?? hostname;
  const records = mainFrame ? [] : [...(previous?.records ?? [])];
  const existingIndex = records.findIndex((record) => record.hostname === hostname);
  if (existingIndex >= 0 && !mainFrame) return;
  const engineEnabled = await currentEngineEnabled();
  let action = "DIRECT";
  if (engineEnabled) {
    try {
      action = (await testConfigRuleMatch(input.url)).action;
    } catch {
      action = "未知";
    }
  }
  const proxied = engineEnabled && action !== "DIRECT" && action !== "未知";
  if (existingIndex >= 0) {
    records.splice(existingIndex, 1);
  }
  records.push({ hostname, action, proxied });
  const state: TabRequestRouteState = { tabId: input.tabId, pageUrl, pageHostname, records };
  await chrome.storage.session.set({ [key]: state });
}

export function recordTabRequestRoute(details: chrome.webRequest.OnBeforeRequestDetails): undefined {
  if (details.tabId < 0) return undefined;
  const previous = tabQueues.get(details.tabId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeRequestRoute({
    tabId: details.tabId,
    url: details.url,
    type: details.type,
  }));
  tabQueues.set(details.tabId, next);
  void next.finally(() => {
    if (tabQueues.get(details.tabId) === next) tabQueues.delete(details.tabId);
  }).catch(() => undefined);
  return undefined;
}

async function seedTabState(tab: chrome.tabs.Tab): Promise<TabRequestRouteState | undefined> {
  if (tab.id === undefined || !requestHostname(tab.url ?? "")) return undefined;
  await writeRequestRoute({ tabId: tab.id, url: tab.url ?? "", type: chrome.webRequest.ResourceType.MAIN_FRAME });
  const key = stateKey(tab.id);
  const stored = await chrome.storage.session.get(key);
  return stored[key] as TabRequestRouteState | undefined;
}

export async function getActiveTabRequestRoutes(): Promise<ActiveTabRequestRoutes | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return undefined;
  await tabQueues.get(tab.id)?.catch(() => undefined);
  const key = stateKey(tab.id);
  const stored = await chrome.storage.session.get(key);
  let state = stored[key] as TabRequestRouteState | undefined;
  if (!state || state.pageUrl !== (tab.url ?? "")) state = await seedTabState(tab);
  if (!state) return undefined;
  const engineEnabled = await currentEngineEnabled();
  const groups = groupRecords(state.records);
  return {
    tabId: tab.id,
    pageUrl: state.pageUrl,
    pageHostname: state.pageHostname,
    engineEnabled,
    totalDomains: state.records.length,
    groups,
  };
}

export async function removeTabRequestRouteState(tabId: number): Promise<void> {
  tabQueues.delete(tabId);
  await chrome.storage.session.remove(stateKey(tabId));
}

export async function clearTabRequestRouteStates(): Promise<void> {
  tabQueues.clear();
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(TAB_REQUEST_ROUTE_STATE_PREFIX));
  if (keys.length > 0) await chrome.storage.session.remove(keys);
}
