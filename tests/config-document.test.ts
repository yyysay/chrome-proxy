import assert from "node:assert/strict";
import test from "node:test";
import {
  SAMPLE_CONFIG_YAML,
  serializeConfigDocument,
  validateConfigDocument,
} from "../src/config/config-document.ts";

test("accepts the minimal YAML configuration model", () => {
  const result = validateConfigDocument(SAMPLE_CONFIG_YAML);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    proxies: 2,
    ruleProviders: 2,
    localRules: 1,
    matchTarget: "香港",
  });
});

test("visual document serialization preserves a valid configuration", () => {
  const parsed = validateConfigDocument(SAMPLE_CONFIG_YAML);
  assert.ok(parsed.document);
  const serialized = serializeConfigDocument(parsed.document);
  const roundTrip = validateConfigDocument(serialized);
  assert.equal(roundTrip.ok, true);
  assert.deepEqual(roundTrip.document, parsed.document);
});

test("accepts list providers and DIRECT targets", () => {
  const result = validateConfigDocument(`
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rule-providers:
  private:
    url: https://example.com/private.list
    behavior: ipcidr
    format: list
rules:
  - RULE-SET,private,DIRECT
  - MATCH,local
`);
  assert.equal(result.ok, true);
});

test("rejects groups, REJECT, missing references and unsupported provider formats", () => {
  const result = validateConfigDocument(`
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rule-providers:
  domains:
    url: https://example.com/domains.mrs
    behavior: domain
    format: mrs
rules:
  - RULE-SET,missing,REJECT
  - MATCH,group
`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("仅支持 yaml 或 list")));
  assert.ok(result.issues.some((issue) => issue.includes("不存在的规则包")));
  assert.ok(result.issues.some((issue) => issue.includes("不支持 REJECT")));
  assert.ok(result.issues.some((issue) => issue.includes("不存在的代理节点")));
});

test("requires MATCH to be the final rule", () => {
  const result = validateConfigDocument(`
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rules:
  - MATCH,local
  - DOMAIN,example.com,DIRECT
`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("MATCH 必须是最后一条规则")));
});

test("requires exactly one MATCH fallback rule", () => {
  const result = validateConfigDocument(`
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rules:
  - DOMAIN,example.com,DIRECT
  - MATCH,local
  - MATCH,DIRECT
`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("必须且只能包含一条 MATCH")));
});

test("rejects rule types outside the minimal set", () => {
  const result = validateConfigDocument(`
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890
rules:
  - DOMAIN-KEYWORD,example,local
  - MATCH,local
`);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("暂不支持的规则类型")));
});
