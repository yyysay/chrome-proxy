import {
  PROXY_STATE_KEY,
} from "../shared/storage-keys.ts";

interface ProxyEndpoint {
  host: string;
  port: number;
}

export interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface StoredProxyState {
  desiredEnabled: boolean;
  updatedAt: string;
}

export function toProxyConfig(node: ProxyEndpoint): ProxyConfig {
  return { type: "http", host: node.host, port: node.port };
}

export async function getDesiredEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PROXY_STATE_KEY);
  const state = stored[PROXY_STATE_KEY] as StoredProxyState | undefined;
  return state?.desiredEnabled === true;
}

export async function setDesiredEnabled(desiredEnabled: boolean): Promise<void> {
  const state: StoredProxyState = {
    desiredEnabled,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [PROXY_STATE_KEY]: state });
}

export async function readEffectiveSetting(): Promise<{ mode?: string; levelOfControl: string }> {
  const result = await chrome.proxy.settings.get({ incognito: false });
  const value = result.value as chrome.proxy.ProxyConfig | undefined;
  return { mode: value?.mode, levelOfControl: result.levelOfControl };
}

export function assertControllable(levelOfControl: string): void {
  if (levelOfControl !== "controllable_by_this_extension" &&
      levelOfControl !== "controlled_by_this_extension") {
    throw new Error(`当前代理设置不可由本扩展控制：${levelOfControl}`);
  }
}

let proxySettingsMutationQueue: Promise<void> = Promise.resolve();

export function runExclusiveProxyMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = proxySettingsMutationQueue.then(task, task);
  proxySettingsMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}
