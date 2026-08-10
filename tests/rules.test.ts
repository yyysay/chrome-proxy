import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetedPacScript, ruleMatchesHostname } from "../src/proxy/pac-builder.ts";
import { parseRules } from "../src/rules/parser.ts";

test("parses supported Mihomo-compatible rules while preserving order", () => {
  const result = parseRules(`DOMAIN,Example.com,DIRECT\nDOMAIN-SUFFIX,.Google.com,PROXY\nIP-CIDR,1.1.1.0/24,PROXY`);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rules.map(({ type, value }) => ({ type, value })), [
    { type: "DOMAIN", value: "example.com" },
    { type: "DOMAIN-SUFFIX", value: "google.com" },
    { type: "IP-CIDR", value: "1.1.1.0/24" },
  ]);
});

test("builds ordered PAC conditions and fallback", () => {
  const parsed = parseRules(`DOMAIN,www.google.org,DIRECT\nDOMAIN-SUFFIX,google.org,PROXY`);
  const result = buildTargetedPacScript(parsed.rules.map((rule) => ({ ...rule, target: rule.value === "www.google.org" ? "DIRECT" : "proxy" })), new Map([["proxy", { host: "127.0.0.1", port: 7890 }]]), "DIRECT");
  assert.ok(result.indexOf('host === "www.google.org"') < result.indexOf('host === "google.org"'));
  assert.match(result, /return "DIRECT";/);
});

test("matcher shares exact, suffix, and CIDR semantics with PAC", () => {
  const rules = parseRules(`DOMAIN,api.example.com,DIRECT\nDOMAIN-SUFFIX,google.com,PROXY\nIP-CIDR,10.0.0.0/8,DIRECT`).rules;
  assert.equal(ruleMatchesHostname(rules[0], "api.example.com"), true);
  assert.equal(ruleMatchesHostname(rules[0], "www.api.example.com"), false);
  assert.equal(ruleMatchesHostname(rules[1], "mail.google.com"), true);
  assert.equal(ruleMatchesHostname(rules[2], "10.23.45.67"), true);
  assert.equal(ruleMatchesHostname(rules[2], "11.23.45.67"), false);
});

test("rejects unsupported rule types", () => {
  const result = parseRules("DOMAIN-KEYWORD,pinterest,PROXY");
  assert.equal(result.rules.length, 0);
  assert.match(result.issues[0]?.message ?? "", /暂不支持/);
});
