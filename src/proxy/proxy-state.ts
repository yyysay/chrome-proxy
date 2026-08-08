import type { FallbackMode } from "../shared/runtime-protocol.ts";
import {
  FALLBACK_MODE_KEY,
  PROXY_EVENT_KEY,
  PROXY_STATE_KEY,
} from "../shared/storage-keys.ts";
import type { ProxyNode } from "./proxy-provider.ts";

export interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface StoredProxyState {
  desiredEnabled: boolean;
  updatedAt: string;
}

export interface ProxyEvent {
  type: "enabled" | "disabled" | "restored" | "lost";
  reason: string;
  occurredAt: string;
  observedMode?: string;
  levelOfControl?: string;
}

export function toProxyConfig(node: ProxyNode): ProxyConfig {
  return { type: "http", host: node.host, port: node.port };
}

export function proxyEndpoint(node: ProxyNode): string {
  return `http://${node.host}:${node.port}`;
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

export async function loadFallbackMode(): Promise<FallbackMode> {
  const stored = await chrome.storage.local.get(FALLBACK_MODE_KEY);
  const value = stored[FALLBACK_MODE_KEY] as unknown;
  return value === "proxy" || value === "system" ? value : "direct";
}

export async function recordProxyEvent(event: Omit<ProxyEvent, "occurredAt">): Promise<void> {
  await chrome.storage.local.set({
    [PROXY_EVENT_KEY]: {
      ...event,
      occurredAt: new Date().toISOString(),
    } satisfies ProxyEvent,
  });
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
