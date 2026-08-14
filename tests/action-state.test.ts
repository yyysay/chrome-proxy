import assert from "node:assert/strict";
import test from "node:test";
import { getActiveTabActionState, removeTabActionState } from "../src/background/action-state.ts";
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
