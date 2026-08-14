import assert from "node:assert/strict";
import test from "node:test";
import { getActiveTabActionState, removeTabActionState, syncActionState } from "../src/background/action-state.ts";
import type { ActiveSiteProxyStatus } from "../src/shared/runtime-protocol.ts";

test("popup site state reuses the tab event cache", async () => {
  const cached: ActiveSiteProxyStatus = {
    tabId: 42,
    url: "https://cached.example/path",
    hostname: "cached.example",
    action: "香港",
    proxied: true,
    engineEnabled: true,
  };
  let actionUpdates = 0;
  let removedKey = "";
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    tabs: {
      async query() { return [{ id: 42, url: cached.url }]; },
    },
    storage: {
      session: {
        async get() { return { "tab-action-state:42": cached }; },
        async set() { throw new Error("cache hit should not recalculate tab state"); },
        async remove(key: string | string[]) { removedKey = String(key); },
      },
    },
    action: {
      async setIcon() { actionUpdates += 1; },
      async setBadgeText() { actionUpdates += 1; },
      async setTitle() { actionUpdates += 1; },
    },
    runtime: {
      getURL(path: string) { return `chrome-extension://test/${path}`; },
    },
  } as unknown as typeof chrome;

  assert.deepEqual(await getActiveTabActionState(), cached);
  assert.equal(actionUpdates, 0);

  await removeTabActionState(42);
  assert.equal(removedKey, "tab-action-state:42");
});

test("extension reload force-restores tab action even when session cache is unchanged", async () => {
  const cached: ActiveSiteProxyStatus = {
    tabId: 42,
    url: "https://direct.example/path",
    hostname: "direct.example",
    action: "已关闭",
    proxied: false,
    engineEnabled: false,
  };
  const actionUpdates: string[] = [];
  let storedState: ActiveSiteProxyStatus | undefined;
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    tabs: {
      async get() { return { id: 42, url: cached.url }; },
    },
    proxy: {
      settings: {
        async get() {
          return { value: { mode: "direct" }, levelOfControl: "controllable_by_this_extension" };
        },
      },
    },
    storage: {
      local: {
        async get() { return {}; },
      },
      session: {
        async get() { return { "tab-action-state:42": cached }; },
        async set(value: Record<string, ActiveSiteProxyStatus>) {
          storedState = value["tab-action-state:42"];
        },
      },
    },
    action: {
      async setIcon() { actionUpdates.push("icon"); },
      async setPopup() { actionUpdates.push("popup"); },
      async setTitle() { actionUpdates.push("title"); },
      async setBadgeText() { actionUpdates.push("badge"); },
    },
    runtime: {
      getURL(path: string) { return `chrome-extension://test/${path}`; },
    },
  } as unknown as typeof chrome;

  await syncActionState(42, cached.url, true);

  assert.deepEqual(actionUpdates.sort(), ["badge", "icon", "popup", "title"]);
  assert.deepEqual(storedState, cached);
});
