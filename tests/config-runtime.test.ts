import assert from "node:assert/strict";
import test from "node:test";
import {
  activateConfigDocument,
  compileConfigRuntime,
  deactivateConfigDocument,
  getActiveConfigProxyState,
  loadActiveConfigRuntime,
  refreshConfigDocumentProviders,
} from "../src/config/config-runtime.ts";
import { buildTargetedPacScript } from "../src/proxy/pac-builder.ts";

function installChromeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
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
  };
  return data;
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
