import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_FALLBACK_PROXY,
  PROXY_SOURCE_MODE_KEY,
  PROXY_SUBSCRIPTION_CACHE_KEY,
  PROXY_SUBSCRIPTION_ERROR_KEY,
  PROXY_SUBSCRIPTION_URL_KEY,
  getProxyProviderState,
  refreshProxySubscription,
  saveProxySubscriptionUrl,
} from "../src/proxy/proxy-provider.ts";

function createStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    api: {
      async get(keys: string | string[] | null) {
        if (keys === null) return Object.fromEntries(data);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, data.get(key)]));
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) data.set(key, value);
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
      },
    },
  };
}

function installChromeStorage(initial: Record<string, unknown> = {}) {
  const storage = createStorage(initial);
  (globalThis as any).chrome = { storage: { local: storage.api } };
  return storage;
}

test("proxy provider falls back to built-in local proxy", async () => {
  installChromeStorage();
  const state = await getProxyProviderState();
  assert.equal(state.sourceMode, "subscription");
  assert.equal(state.effectiveSource, "fallback");
  assert.deepEqual(state.activeProxy, BUILTIN_FALLBACK_PROXY);
});

test("proxy subscription caches multiple entries but automatically uses the first one", async () => {
  const storage = installChromeStorage({ [PROXY_SOURCE_MODE_KEY]: "subscription" });
  const url = "https://config.example.com/proxies.json";
  await saveProxySubscriptionUrl(url);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    version: 1,
    updatedAt: "2026-08-07T15:30:00+08:00",
    proxies: [
      { id: "jp", name: "Japan", type: "http", host: "10.0.0.10", port: 7890 },
      { id: "hk", name: "Hong Kong", type: "http", host: "10.0.0.11", port: 7890 },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    const refreshed = await refreshProxySubscription();
    assert.equal(refreshed.usedCached, false);
    assert.equal(refreshed.state.effectiveSource, "subscription");
    assert.equal(refreshed.state.activeProxy.id, "jp");
    assert.equal(refreshed.state.proxies.length, 2);
    assert.ok(storage.data.has(PROXY_SUBSCRIPTION_CACHE_KEY));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy subscription keeps last-known-good data when refresh fails", async () => {
  const url = "https://config.example.com/proxies.json";
  const cache = {
    url,
    document: {
      version: 1,
      proxies: [{ id: "jp", name: "Japan", type: "http", host: "10.0.0.10", port: 7890 }],
    },
    fetchedAt: "2026-08-07T15:00:00.000Z",
    lastAttemptAt: "2026-08-07T15:00:00.000Z",
    status: "ready",
  };
  const storage = installChromeStorage({
    [PROXY_SOURCE_MODE_KEY]: "subscription",
    [PROXY_SUBSCRIPTION_URL_KEY]: url,
    [PROXY_SUBSCRIPTION_CACHE_KEY]: cache,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try {
    const refreshed = await refreshProxySubscription();
    assert.equal(refreshed.usedCached, true);
    assert.equal(refreshed.state.activeProxy.id, "jp");
    assert.equal(refreshed.state.subscription?.status, "cached");
    assert.match(String(storage.data.get(PROXY_SUBSCRIPTION_ERROR_KEY)), /offline/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
