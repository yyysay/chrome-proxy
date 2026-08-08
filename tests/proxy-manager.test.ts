import assert from "node:assert/strict";
import test from "node:test";

import { MANAGED_RULE_PACK_IDS } from "../src/rule-packs/catalog.ts";
import {
  beginNetworkInfoCheck,
  bootstrapDefaultRulePacks,
  disableProxy,
  enableProxy,
  finishNetworkInfoCheck,
  getRulePackSettings,
  getProxyStatus,
  migrateStoredData,
  refreshEnabledRulePacks,
  reconcileProxy,
  saveRulePack,
  updateEnabledRulePacks,
  updateFallbackMode,
} from "../src/proxy/proxy-manager.ts";
import {
  DISABLED_DEFAULT_RULE_PACK_IDS_KEY,
  FALLBACK_MODE_KEY,
  PROXY_MANUAL_OVERRIDE_KEY,
  PROXY_SOURCE_MODE_KEY,
  PROXY_STATE_KEY,
  PROXY_SUBSCRIPTION_CACHE_KEY,
  PROXY_SUBSCRIPTION_ERROR_KEY,
  PROXY_SUBSCRIPTION_URL_KEY,
  RULE_PACK_DEFINITIONS_KEY,
  RULE_PACK_SOURCES_KEY,
} from "../src/shared/storage-keys.ts";

interface MockChromeOptions {
  initial?: Record<string, unknown>;
  proxyMode?: string;
  levelOfControl?: string;
}

function installChrome(options: MockChromeOptions = {}) {
  const data = new Map(Object.entries(options.initial ?? {}));
  let proxyValue: Record<string, unknown> = { mode: options.proxyMode ?? "system" };
  let levelOfControl = options.levelOfControl ?? "controllable_by_this_extension";
  let setCount = 0;
  let clearCount = 0;

  const storage = {
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
  };

  (globalThis as any).chrome = {
    storage: { local: storage },
    proxy: {
      settings: {
        async get() {
          return { value: proxyValue, levelOfControl };
        },
        async set({ value }: { value: Record<string, unknown> }) {
          proxyValue = value;
          levelOfControl = "controlled_by_this_extension";
          setCount += 1;
        },
        async clear() {
          proxyValue = { mode: "system" };
          levelOfControl = "controllable_by_this_extension";
          clearCount += 1;
        },
      },
    },
  };

  return {
    data,
    get proxyValue() { return proxyValue; },
    get levelOfControl() { return levelOfControl; },
    get setCount() { return setCount; },
    get clearCount() { return clearCount; },
  };
}

function manualProxyState(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [PROXY_SOURCE_MODE_KEY]: "manual",
    [PROXY_MANUAL_OVERRIDE_KEY]: {
      id: "manual",
      name: "Manual Proxy",
      type: "http",
      host: "10.0.1.2",
      port: 6152,
    },
    [FALLBACK_MODE_KEY]: "direct",
    ...extra,
  };
}

test("enabling and disabling proxy persists the desired state", async () => {
  const mock = installChrome({ initial: manualProxyState() });

  const config = await enableProxy();
  assert.deepEqual(config, { type: "http", host: "10.0.1.2", port: 6152 });
  assert.equal(mock.proxyValue.mode, "pac_script");
  assert.match(String((mock.proxyValue.pacScript as { data?: string }).data), /PROXY 10\.0\.1\.2:6152/);
  assert.equal((mock.data.get(PROXY_STATE_KEY) as { desiredEnabled?: boolean }).desiredEnabled, true);
  assert.equal((await getProxyStatus()).applied, true);

  await disableProxy();
  assert.equal(mock.proxyValue.mode, "system");
  assert.equal((mock.data.get(PROXY_STATE_KEY) as { desiredEnabled?: boolean }).desiredEnabled, false);
  assert.equal((await getProxyStatus()).applied, false);
});

test("reconcile restores a lost PAC but skips an already controlled PAC", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [PROXY_STATE_KEY]: { desiredEnabled: true, updatedAt: new Date().toISOString() },
    }),
  });

  assert.equal(await reconcileProxy("test.lost"), true);
  assert.equal(mock.proxyValue.mode, "pac_script");
  assert.equal(mock.setCount, 1);

  assert.equal(await reconcileProxy("test.unchanged"), false);
  assert.equal(mock.setCount, 1);
});

test("system fallback releases Chrome proxy control while remaining enabled", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [FALLBACK_MODE_KEY]: "system",
      [PROXY_STATE_KEY]: { desiredEnabled: true, updatedAt: new Date().toISOString() },
    }),
    proxyMode: "pac_script",
    levelOfControl: "controlled_by_this_extension",
  });

  assert.equal(await reconcileProxy("test.system"), true);
  assert.equal(mock.clearCount, 1);
  assert.equal(mock.proxyValue.mode, "system");
  assert.equal((await getProxyStatus()).applied, true);
});

test("failed fallback changes restore the previous mode", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [PROXY_STATE_KEY]: { desiredEnabled: true, updatedAt: new Date().toISOString() },
    }),
    levelOfControl: "controlled_by_other_extensions",
  });

  await assert.rejects(updateFallbackMode("proxy"), /不可由本扩展控制/);
  assert.equal(mock.data.get(FALLBACK_MODE_KEY), "direct");
});

test("failed rule application rolls back custom rule storage", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [PROXY_STATE_KEY]: { desiredEnabled: true, updatedAt: new Date().toISOString() },
    }),
    levelOfControl: "controlled_by_other_extensions",
  });

  await assert.rejects(
    saveRulePack(
      undefined,
      "Rollback Test",
      "",
      "PROXY",
      "DOMAIN-SUFFIX,example.com,PROXY",
      "local-first",
    ),
    /不可由本扩展控制/,
  );
  assert.deepEqual(mock.data.get(RULE_PACK_DEFINITIONS_KEY), []);
  assert.deepEqual(mock.data.get(RULE_PACK_SOURCES_KEY), {});
});

test("network probe always returns to the user's disabled state", async () => {
  const mock = installChrome({ initial: manualProxyState() });

  await beginNetworkInfoCheck();
  assert.equal(mock.proxyValue.mode, "pac_script");
  assert.match(String((mock.proxyValue.pacScript as { data?: string }).data), /myip\.ipip\.net/);

  await finishNetworkInfoCheck();
  assert.equal(mock.proxyValue.mode, "system");
  assert.equal(mock.clearCount, 1);
});

test("default rules can be disabled and stale managed definitions stay hidden", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [RULE_PACK_DEFINITIONS_KEY]: [{
        id: "managed-github",
        name: "GitHub",
        description: "removed default",
        enabledByDefault: true,
        defaultUrl: "https://example.com/github.yaml",
        defaultAction: "PROXY",
        kind: "managed",
      }],
    }),
  });

  const before = await getRulePackSettings();
  assert.equal(before.some((pack) => pack.name === "GitHub"), false);
  assert.equal(before.find((pack) => pack.category === "default")?.enabled, true);

  await updateEnabledRulePacks([]);
  const after = await getRulePackSettings();
  assert.equal(after.find((pack) => pack.category === "default")?.enabled, false);
  assert.deepEqual(mock.data.get(DISABLED_DEFAULT_RULE_PACK_IDS_KEY), [...MANAGED_RULE_PACK_IDS]);
  assert.deepEqual(await refreshEnabledRulePacks(), {
    refreshed: 0,
    cached: 0,
    failed: 0,
    skipped: 0,
  });
});

test("default rules bootstrap once with direct, system, and current proxy fallback", async () => {
  const mock = installChrome({
    initial: manualProxyState({
      [DISABLED_DEFAULT_RULE_PACK_IDS_KEY]: MANAGED_RULE_PACK_IDS.slice(1),
    }),
  });
  const originalFetch = globalThis.fetch;
  const attemptedModes: string[] = [];
  globalThis.fetch = (async () => {
    attemptedModes.push(String(mock.proxyValue.mode));
    if (attemptedModes.length < 3) throw new Error("route unavailable");
    return new Response("payload:\n  - +.pinterest.com", { status: 200 });
  }) as typeof fetch;

  try {
    assert.deepEqual(await bootstrapDefaultRulePacks(), {
      refreshed: 1,
      failed: 0,
      skipped: 0,
    });
    assert.deepEqual(attemptedModes, ["direct", "system", "pac_script"]);
    assert.equal(mock.proxyValue.mode, "system");
    const sources = mock.data.get(RULE_PACK_SOURCES_KEY) as Record<string, { cachedContent?: string }>;
    assert.match(sources["managed-pinterest"].cachedContent ?? "", /pinterest\.com/);

    assert.deepEqual(await bootstrapDefaultRulePacks(), {
      refreshed: 0,
      failed: 0,
      skipped: 1,
    });
    assert.equal(attemptedModes.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migration removes the legacy built-in proxy subscription address", async () => {
  const legacyUrl = "https://dufs.ms.y3-3am.top/autoproxy/proxies.json";
  const mock = installChrome({
    initial: {
      schemaVersion: 5,
      [PROXY_SUBSCRIPTION_URL_KEY]: legacyUrl,
      [PROXY_SUBSCRIPTION_CACHE_KEY]: { url: legacyUrl },
      [PROXY_SUBSCRIPTION_ERROR_KEY]: "offline",
    },
  });

  await migrateStoredData();
  assert.equal(mock.data.get("schemaVersion"), 6);
  assert.equal(mock.data.has(PROXY_SUBSCRIPTION_URL_KEY), false);
  assert.equal(mock.data.has(PROXY_SUBSCRIPTION_CACHE_KEY), false);
  assert.equal(mock.data.has(PROXY_SUBSCRIPTION_ERROR_KEY), false);
});
