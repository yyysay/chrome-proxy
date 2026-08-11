import assert from "node:assert/strict";
import test from "node:test";
import { activateConfigDocument } from "../src/config/config-runtime.ts";
import { getSiteProxyStatus, testConfigRuleMatch } from "../src/config/config-service.ts";
import { beginNetworkInfoCheck, finishNetworkInfoCheck } from "../src/proxy/network-probe.ts";
import { disableProxy, enableProxy, getProxyStatus, reconcileProxy } from "../src/proxy/pac-controller.ts";
import { PROXY_STATE_KEY } from "../src/shared/storage-keys.ts";

function installChrome(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  let proxyValue: Record<string, unknown> = { mode: "system" };
  let levelOfControl = "controllable_by_this_extension";
  let setCount = 0;
  const local = {
    async get(keys: string | string[]) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, data.get(key)])); },
    async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) data.set(key, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); },
  };
  (globalThis as any).chrome = {
    storage: { local }, alarms: { async clear() {}, async create() {} },
    proxy: { settings: {
      async get() { return { value: proxyValue, levelOfControl }; },
      async set({ value }: { value: Record<string, unknown> }) { proxyValue = value; levelOfControl = "controlled_by_this_extension"; setCount += 1; },
      async clear() { proxyValue = { mode: "system" }; levelOfControl = "controllable_by_this_extension"; },
    } },
  };
  return { data, get proxyValue() { return proxyValue; }, get setCount() { return setCount; } };
}

const YAML = `
proxies:
  - name: 香港
    type: http
    server: 10.0.0.10
    port: 7890
  - name: 日本
    type: http
    server: 10.0.0.11
    port: 7891
rules:
  - DOMAIN,hk.example,香港
  - DOMAIN,jp.example,日本
  - DOMAIN,direct.example,DIRECT
  - MATCH,香港
`;

test("configuration is required before enabling", async () => {
  installChrome();
  await assert.rejects(enableProxy(), /保存并应用 YAML 配置/);
});

test("active YAML drives enable, status, multi-node PAC, match test and disable", async () => {
  const mock = installChrome();
  await activateConfigDocument(YAML);
  assert.deepEqual(await enableProxy(), { type: "http", host: "10.0.0.10", port: 7890 });
  const pac = String((mock.proxyValue.pacScript as { data?: string }).data);
  assert.match(pac, /hk\.example[^\n]+PROXY 10\.0\.0\.10:7890/);
  assert.match(pac, /jp\.example[^\n]+PROXY 10\.0\.0\.11:7891/);
  assert.equal((await getProxyStatus()).configured, true);
  assert.deepEqual(await testConfigRuleMatch("jp.example"), { hostname: "jp.example", action: "日本", matched: true, rule: { type: "DOMAIN", value: "jp.example" } });
  assert.equal((await getSiteProxyStatus("https://jp.example/")).proxied, true);
  assert.equal((await getSiteProxyStatus("https://direct.example/")).proxied, false);
  await disableProxy();
  assert.equal((mock.data.get(PROXY_STATE_KEY) as { desiredEnabled: boolean }).desiredEnabled, false);
  assert.equal(mock.proxyValue.mode, "system");
});

test("reconcile restores only when a configured proxy is desired", async () => {
  const mock = installChrome();
  await activateConfigDocument(YAML);
  await chrome.storage.local.set({ [PROXY_STATE_KEY]: { desiredEnabled: true, updatedAt: new Date().toISOString() } });
  assert.equal(await reconcileProxy(), true);
  assert.equal(await reconcileProxy(), false);
  assert.equal(mock.setCount, 1);
});

test("network probe can target a configured node and restores disabled system state", async () => {
  const mock = installChrome();
  await activateConfigDocument(YAML);
  assert.deepEqual(await beginNetworkInfoCheck("日本"), { type: "http", host: "10.0.0.11", port: 7891 });
  assert.match(String((mock.proxyValue.pacScript as { data?: string }).data), /PROXY 10\.0\.0\.11:7891/);
  assert.doesNotMatch(String((mock.proxyValue.pacScript as { data?: string }).data), /DIRECT/);
  await finishNetworkInfoCheck();
  assert.equal(mock.proxyValue.mode, "system");
});
