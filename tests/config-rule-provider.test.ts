import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigRuleProvider } from "../src/config/config-document.ts";
import { parseConfigRuleProvider } from "../src/config/rule-provider-parser.ts";

function provider(overrides: Partial<ConfigRuleProvider> = {}): ConfigRuleProvider {
  return {
    name: "test",
    url: "https://example.com/rules.yaml",
    behavior: "domain",
    format: "yaml",
    interval: 86_400,
    ...overrides,
  };
}

test("parses YAML domain payloads", () => {
  assert.deepEqual(parseConfigRuleProvider(provider(), `payload:\n  - +.example.com\n  - exact.example\n`), [
    { type: "DOMAIN-SUFFIX", value: "example.com" },
    { type: "DOMAIN", value: "exact.example" },
  ]);
});

test("parses list IP-CIDR providers", () => {
  assert.deepEqual(parseConfigRuleProvider(provider({ behavior: "ipcidr", format: "list" }), `
# private networks
10.0.0.0/8
192.168.1.0/24
::/127
`), [
    { type: "IP-CIDR", value: "10.0.0.0/8" },
    { type: "IP-CIDR", value: "192.168.1.0/24" },
    { type: "IP-CIDR", value: "::/127" },
  ]);
});

test("parses classical providers but ignores their embedded target", () => {
  assert.deepEqual(parseConfigRuleProvider(provider({ behavior: "classical", format: "list" }), `
DOMAIN-SUFFIX,example.com,ignored
IP-CIDR,10.0.0.0/8,no-resolve
`), [
    { type: "DOMAIN-SUFFIX", value: "example.com" },
    { type: "IP-CIDR", value: "10.0.0.0/8" },
  ]);
});
