import assert from "node:assert/strict";
import test from "node:test";
import {
  activateConfigDocument,
  compileConfigRuntime,
  CONFIG_PROVIDER_REFRESH_ALARM,
  deactivateConfigDocument,
  getActiveConfigProxyState,
  getConfigDocumentState,
  getConfigProviderContent,
  loadActiveConfigRuntime,
  refreshConfigDocumentProviders,
  refreshRemoteConfigDocument,
  REMOTE_CONFIG_REFRESH_ALARM,
} from "../src/config/config-runtime.ts";
import { buildTargetedPacScript } from "../src/proxy/pac-builder.ts";
import { CONFIG_PROVIDER_CACHE_KEY } from "../src/shared/storage-keys.ts";

function installChromeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();
  (globalThis as any).chrome = {
    storage: {
      local: {
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
    },
    alarms: {
      async create(name: string, info: chrome.alarms.AlarmCreateInfo) { alarms.set(name, info); },
      async clear(name: string) { return alarms.delete(name); },
    },
  };
  return { data, alarms };
}

const CONFIG = `
proxies:
  - name: 香港
    type: http
    server: 10.0.0.10
    port: 7890
  - name: 日本
    type: http
    server: 10.0.0.11
    port: 7891
rule-providers:
  remote:
    url: https://rules.example.net/domains.yaml
    behavior: domain
    format: yaml
rules:
  - RULE-SET,remote,香港
  - DOMAIN,local.example,日本
  - MATCH,香港
`;

test("activates remote providers and compiles different nodes into one PAC", async () => {
  installChromeStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`payload:\n  - +.remote.example\n`, { status: 200 })) as typeof fetch;
  try {
    const activated = await activateConfigDocument(CONFIG, "https://config.example.net/auto.yaml");
    assert.equal(activated.state.active, true);
    assert.equal(activated.state.sourceUrl, "https://config.example.net/auto.yaml");
    assert.equal(activated.refreshed, 1);

    const runtime = await loadActiveConfigRuntime();
    assert.ok(runtime);
    const compiled = compileConfigRuntime(runtime);
    assert.equal(compiled.rules.length, 2);
    assert.equal(compiled.rules[0].target, "香港");
    assert.equal(compiled.rules[1].target, "日本");
    assert.equal(compiled.fallbackTarget, "香港");

    const pac = buildTargetedPacScript(
      compiled.rules,
      compiled.proxies,
      compiled.fallbackTarget,
      compiled.providerHosts,
    );
    assert.match(pac, /remote\.example/);
    assert.match(pac, /PROXY 10\.0\.0\.10:7890/);
    assert.match(pac, /local\.example/);
    assert.match(pac, /config\.example\.net/);
    assert.match(pac, /PROXY 10\.0\.0\.11:7891/);

    const proxyState = await getActiveConfigProxyState();
    assert.equal(proxyState?.activeProxy.name, "香港");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps the last valid provider cache when refresh fails", async () => {
  installChromeStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`payload:\n  - cached.example\n`, { status: 200 })) as typeof fetch;
  try {
    await activateConfigDocument(CONFIG);
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    const refreshed = await refreshConfigDocumentProviders();
    assert.equal(refreshed.cached, 1);
    assert.equal(refreshed.state.providers.remote.status, "cached");
    assert.match(refreshed.state.providers.remote.error ?? "", /offline/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not download or cache rule providers without an enabled RULE-SET", async () => {
  const mock = installChromeStorage();
  const yaml = CONFIG.replace(
    "  - RULE-SET,remote,香港",
    "  # disabled-rule: RULE-SET,remote,香港",
  );
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    requested.push(String(input));
    return new Response("payload:\n  - remote.example\n", { status: 200 });
  }) as typeof fetch;
  try {
    const activated = await activateConfigDocument(yaml);
    assert.equal(activated.refreshed, 0);
    assert.deepEqual(requested, []);
    assert.deepEqual(mock.data.get(CONFIG_PROVIDER_CACHE_KEY), {});
    assert.equal(mock.alarms.has(CONFIG_PROVIDER_REFRESH_ALARM), false);

    const runtime = await loadActiveConfigRuntime();
    assert.ok(runtime);
    assert.equal(compileConfigRuntime(runtime).rules.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deactivation preserves the saved YAML but stops the runtime", async () => {
  installChromeStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`payload:\n  - remote.example\n`, { status: 200 })) as typeof fetch;
  try {
    await activateConfigDocument(CONFIG);
    const state = await deactivateConfigDocument();
    assert.equal(state.active, false);
    assert.equal(state.yaml.trim(), CONFIG.trim());
    assert.equal(await loadActiveConfigRuntime(), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatically refreshes remote YAML and exposes provider cache details", async () => {
  installChromeStorage();
  const originalFetch = globalThis.fetch;
  const sourceUrl = "https://config.example.net/auto.yaml";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === sourceUrl) return new Response(CONFIG.replace("local.example", "updated.example"), { status: 200 });
    return new Response("payload:\n  - remote.example\n", { status: 200 });
  }) as typeof fetch;
  try {
    await activateConfigDocument(CONFIG, sourceUrl, 21_600);
    const refreshed = await refreshRemoteConfigDocument();
    assert.match(refreshed.state.yaml, /updated\.example/);
    assert.equal(refreshed.state.remote.status, "ready");
    assert.equal(refreshed.state.remote.intervalSeconds, 21_600);
    const provider = await getConfigProviderContent("remote");
    assert.equal(provider.ruleCount, 1);
    assert.match(provider.content, /remote\.example/);

    globalThis.fetch = (async (input) => {
      if (String(input) === sourceUrl) throw new Error("offline");
      return new Response("payload:\n  - remote.example\n", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(refreshRemoteConfigDocument(), /自动同步失败/);
    const failed = await getConfigDocumentState();
    assert.equal(failed.remote.status, "error");
    assert.match(failed.remote.error ?? "", /offline/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsupported remote YAML refresh intervals", async () => {
  installChromeStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("payload:\n  - remote.example\n", { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      activateConfigDocument(CONFIG, "https://config.example.net/auto.yaml", 18_000),
      /自动更新周期无效/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads the previous hour-based remote interval as seconds", async () => {
  installChromeStorage({
    configDocumentActive: true,
    configDocumentYaml: CONFIG,
    configDocumentUrl: "https://config.example.net/auto.yaml",
    configDocumentRefreshIntervalHours: 6,
  });
  const state = await getConfigDocumentState();
  assert.equal(state.remote.intervalSeconds, 21_600);
});

test("schedules remote YAML and rule providers from seconds", async () => {
  const mock = installChromeStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("payload:\n  - remote.example\n", { status: 200 })) as typeof fetch;
  try {
    await activateConfigDocument(CONFIG, "https://config.example.net/auto.yaml", 21_600);
    assert.equal(mock.alarms.get(REMOTE_CONFIG_REFRESH_ALARM)?.periodInMinutes, 360);
    assert.equal(mock.alarms.get(CONFIG_PROVIDER_REFRESH_ALARM)?.periodInMinutes, 1440);

    await activateConfigDocument(CONFIG, "https://config.example.net/auto.yaml", 0);
    assert.equal(mock.alarms.has(REMOTE_CONFIG_REFRESH_ALARM), false);
    assert.equal(mock.alarms.get(CONFIG_PROVIDER_REFRESH_ALARM)?.periodInMinutes, 1440);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider alarm refreshes only rule providers whose interval is due", async () => {
  const mock = installChromeStorage();
  const yaml = `
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rule-providers:
  hourly:
    url: https://rules.example.net/hourly.yaml
    behavior: domain
    format: yaml
    interval: 3600
  daily:
    url: https://rules.example.net/daily.yaml
    behavior: domain
    format: yaml
    interval: 86400
rules:
  - RULE-SET,hourly,local
  - RULE-SET,daily,local
  - MATCH,local
`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("payload:\n  - remote.example\n", { status: 200 })) as typeof fetch;
  try {
    await activateConfigDocument(yaml);
    const caches = mock.data.get(CONFIG_PROVIDER_CACHE_KEY) as Record<string, { lastAttemptAt: string }>;
    caches.hourly.lastAttemptAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    caches.daily.lastAttemptAt = new Date().toISOString();
    const requested: string[] = [];
    globalThis.fetch = (async (input) => {
      requested.push(String(input));
      return new Response("payload:\n  - refreshed.example\n", { status: 200 });
    }) as typeof fetch;

    const result = await refreshConfigDocumentProviders(true);
    assert.equal(result.refreshed, 1);
    assert.deepEqual(requested, ["https://rules.example.net/hourly.yaml"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
