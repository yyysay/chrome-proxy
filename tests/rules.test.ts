import assert from "node:assert/strict";
import test from "node:test";

import { buildPacScript } from "../src/proxy/pac-builder.ts";
import {
  BUILTIN_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../src/rule-packs/catalog.ts";
import { compileRulePacks } from "../src/rule-packs/compiler.ts";
import { parseRules } from "../src/rules/parser.ts";

test("parses Surge and Mihomo rules while preserving order", () => {
  const input = `\uFEFF[Rule]
DOMAIN,Example.com,DIRECT
- 'DOMAIN-SUFFIX,.Google.com,Proxy Group'
- "DOMAIN-KEYWORD,openai,REJECT-DROP"
FINAL,DIRECT`;

  const result = parseRules(input);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.rules.map(({ type, value, action }) => ({ type, value, action })),
    [
      { type: "DOMAIN", value: "example.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", value: "google.com", action: "PROXY" },
      { type: "DOMAIN-KEYWORD", value: "openai", action: "REJECT" },
      { type: "MATCH", value: undefined, action: "DIRECT" },
    ],
  );
});

test("reports unsupported, missing, and invalid rules", () => {
  const result = parseRules(`IP-CIDR,1.1.1.0/24,PROXY
DOMAIN,,DIRECT
DOMAIN-SUFFIX,https://example.com,PROXY`);

  assert.equal(result.rules.length, 0);
  assert.deepEqual(
    result.issues.map(({ lineNumber, message }) => ({ lineNumber, message })),
    [
      { lineNumber: 1, message: "暂不支持的规则类型：IP-CIDR" },
      { lineNumber: 2, message: "规则缺少匹配内容" },
      { lineNumber: 3, message: "无效的匹配内容：https://example.com" },
    ],
  );
});

test("builds an ordered PAC and stops after MATCH", () => {
  const parsed = parseRules(`DOMAIN,www.google.org,DIRECT
DOMAIN-SUFFIX,google.org,PROXY
MATCH,DIRECT
DOMAIN,ignored.example,PROXY`);
  const result = buildPacScript(parsed.rules, {
    host: "127.0.0.1",
    port: 7890,
  });

  const exactIndex = result.script.indexOf('host === "www.google.org"');
  const suffixIndex = result.script.indexOf('host === "google.org"');

  assert.ok(exactIndex >= 0);
  assert.ok(suffixIndex > exactIndex);
  assert.match(result.script, /return "DIRECT";/);
  assert.doesNotMatch(result.script, /ignored\.example/);
});

test("falls back to DIRECT and warns when REJECT cannot be represented", () => {
  const parsed = parseRules("DOMAIN-KEYWORD,ads,REJECT");
  const result = buildPacScript(parsed.rules, {
    host: "127.0.0.1",
    port: 7890,
  });

  assert.equal(result.warnings.length, 1);
  assert.match(result.script, /return "DIRECT";/);
});

test("default rule packs are empty and fall back to direct", () => {
  const compiled = compileRulePacks(
    BUILTIN_RULE_PACKS,
    DEFAULT_ENABLED_RULE_PACK_IDS,
  );

  assert.deepEqual(
    compiled.rules.map(({ type, value, action }) => ({
      type,
      value,
      action,
    })),
    [
      { type: "MATCH", value: undefined, action: "DIRECT" },
    ],
  );
});

test("disabled rule packs are excluded without changing catalog order", () => {
  const compiled = compileRulePacks(
    BUILTIN_RULE_PACKS,
    ["ip125-proxy-test"],
  );

  assert.deepEqual(compiled.enabledPackIds, ["ip125-proxy-test"]);
  assert.deepEqual(
    compiled.rules.map(({ value, action }) => ({ value, action })),
    [
      { value: "ip125.com", action: "PROXY" },
      { value: undefined, action: "DIRECT" },
    ],
  );
});

test("global diagnostic pack ends PAC rules with proxy", () => {
  const compiled = compileRulePacks(
    BUILTIN_RULE_PACKS,
    ["google-direct-test", "global-proxy-diagnostic"],
  );

  assert.deepEqual(
    compiled.rules.map(({ value, action }) => ({ value, action })),
    [
      { value: "google.com", action: "DIRECT" },
      { value: undefined, action: "PROXY" },
      { value: undefined, action: "DIRECT" },
    ],
  );

  const pac = buildPacScript(compiled.rules, {
    host: "10.0.1.1",
    port: 6152,
  });

  assert.match(pac.script, /return "PROXY 10\.0\.1\.1:6152";/);
  assert.doesNotMatch(
    pac.script.slice(pac.script.indexOf('return "PROXY 10.0.1.1:6152";')),
    /return "DIRECT";/,
  );
});

test("proxy fallback sends unmatched websites to configured proxy", () => {
  const compiled = compileRulePacks(BUILTIN_RULE_PACKS, [], "PROXY");
  const pac = buildPacScript(compiled.rules, {
    host: "10.0.1.2",
    port: 6152,
  });

  assert.match(pac.script, /return "PROXY 10\.0\.1\.2:6152";/);
  assert.doesNotMatch(pac.script, /return "DIRECT";/);
});
