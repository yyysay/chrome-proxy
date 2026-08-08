import assert from "node:assert/strict";
import test from "node:test";

import { buildPacScript, ruleMatchesHostname } from "../src/proxy/pac-builder.ts";
import {
  BUILTIN_RULE_PACKS,
  DEFAULT_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../src/rule-packs/catalog.ts";
import { compileRulePacks } from "../src/rule-packs/compiler.ts";
import {
  buildRulePackContent,
  normalizeRuleSourceStrategy,
} from "../src/rule-packs/repository.ts";
import {
  analyzeProviderRules,
  normalizeProviderRules,
} from "../src/rule-packs/provider-parser.ts";
import { parseRules } from "../src/rules/parser.ts";

test("parses Surge and Mihomo rules while preserving order", () => {
  const input = `\uFEFF[Rule]
DOMAIN,Example.com,DIRECT
- 'DOMAIN-SUFFIX,.Google.com,Proxy Group'
- "DOMAIN-KEYWORD,openai,REJECT-DROP"`;

  const result = parseRules(input);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.rules.map(({ type, value, action }) => ({ type, value, action })),
    [
      { type: "DOMAIN", value: "example.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", value: "google.com", action: "PROXY" },
      { type: "DOMAIN-KEYWORD", value: "openai", action: "REJECT" },
    ],
  );
});

test("reports unsupported, missing, and invalid rules", () => {
  const result = parseRules(`IP-CIDR,1.1.1.0/24,PROXY
DOMAIN,,DIRECT
DOMAIN-SUFFIX,https://example.com,PROXY
MATCH,DIRECT
FINAL,PROXY`);

  assert.equal(result.rules.length, 0);
  assert.deepEqual(
    result.issues.map(({ lineNumber, message }) => ({ lineNumber, message })),
    [
      { lineNumber: 1, message: "暂不支持的规则类型：IP-CIDR" },
      { lineNumber: 2, message: "规则缺少匹配内容" },
      { lineNumber: 3, message: "无效的匹配内容：https://example.com" },
      { lineNumber: 4, message: "暂不支持的规则类型：MATCH" },
      { lineNumber: 5, message: "暂不支持的规则类型：FINAL" },
    ],
  );
});

test("builds an ordered PAC and appends the selected fallback", () => {
  const parsed = parseRules(`DOMAIN,www.google.org,DIRECT
DOMAIN-SUFFIX,google.org,PROXY
DOMAIN,after.example,PROXY`);
  const result = buildPacScript(parsed.rules, {
    host: "127.0.0.1",
    port: 7890,
  }, "DIRECT");

  const exactIndex = result.script.indexOf('host === "www.google.org"');
  const suffixIndex = result.script.indexOf('host === "google.org"');

  assert.ok(exactIndex >= 0);
  assert.ok(suffixIndex > exactIndex);
  assert.match(result.script, /after\.example/);
  assert.match(result.script, /return "DIRECT";/);
});

test("routes managed rule source hosts through the configured proxy before user rules", () => {
  const parsed = parseRules("DOMAIN,raw.githubusercontent.com,DIRECT");
  const result = buildPacScript(
    parsed.rules,
    { host: "127.0.0.1", port: 7890 },
    "DIRECT",
    ["raw.githubusercontent.com"],
  );

  const forcedIndex = result.script.indexOf('dnsDomainIs(host, ".raw.githubusercontent.com")');
  const userRuleIndex = result.script.indexOf('host === "raw.githubusercontent.com"', forcedIndex + 1);

  assert.ok(forcedIndex >= 0);
  assert.ok(userRuleIndex > forcedIndex);
  assert.match(
    result.script.slice(forcedIndex, userRuleIndex),
    /return "PROXY 127\.0\.0\.1:7890";/,
  );
});

test("falls back to DIRECT and warns when REJECT cannot be represented", () => {
  const parsed = parseRules("DOMAIN-KEYWORD,ads,REJECT");
  const result = buildPacScript(parsed.rules, {
    host: "127.0.0.1",
    port: 7890,
  }, "DIRECT");

  assert.equal(result.warnings.length, 1);
  assert.match(result.script, /return "DIRECT";/);
});

test("built-in rules stay active independently from default subscriptions", () => {
  const compiled = compileRulePacks(
    [...DEFAULT_RULE_PACKS, ...BUILTIN_RULE_PACKS],
    DEFAULT_ENABLED_RULE_PACK_IDS,
  );

  assert.ok(DEFAULT_RULE_PACKS.every((pack) => pack.defaultUrl && !pack.rulesText));
  assert.ok(BUILTIN_RULE_PACKS.every((pack) => !pack.defaultUrl && pack.rulesText));
  assert.ok(compiled.rules.length > 0);
  assert.ok(BUILTIN_RULE_PACKS.every((pack) => compiled.enabledPackIds.includes(pack.id)));
});

test("disabled rule packs are excluded without changing catalog order", () => {
  const catalog = [
    {
      id: "google",
      name: "Google",
      description: "test",
      enabledByDefault: false,
      defaultUrl: "https://example.com/google.yaml",
      defaultAction: "PROXY" as const,
      rulesText: "DOMAIN-SUFFIX,google.com,PROXY",
    },
    {
      id: "pinterest",
      name: "Pinterest",
      description: "test",
      enabledByDefault: false,
      defaultUrl: "https://example.com/pinterest.yaml",
      defaultAction: "PROXY" as const,
      rulesText: "DOMAIN-SUFFIX,pinterest.com,PROXY",
    },
  ];
  const compiled = compileRulePacks(
    catalog,
    ["pinterest"],
  );

  assert.deepEqual(compiled.enabledPackIds, ["pinterest"]);
  assert.deepEqual(
    compiled.rules.map(({ value, action }) => ({ value, action })),
    [
      { value: "pinterest.com", action: "PROXY" },
    ],
  );
});

test("normalizes domain-provider YAML and ignores typed Clash payload", () => {
  const content = `payload:
  - +.google.com
  - accounts.google.com
  - DOMAIN-SUFFIX,pinterest.com
  - DOMAIN,pinimg.com`;

  assert.equal(
    normalizeProviderRules(content, "PROXY"),
    [
      "DOMAIN-SUFFIX,google.com,PROXY",
      "DOMAIN,accounts.google.com,PROXY",
      "DOMAIN-SUFFIX,pinterest.com,PROXY",
      "DOMAIN,pinimg.com,PROXY",
    ].join("\n"),
  );
  assert.equal(analyzeProviderRules(content, "PROXY").ignored, 0);
});

test("content strategies never fall back to the other source", () => {
  const pack = {
    id: "strategy-test",
    name: "Strategy Test",
    description: "test",
    enabledByDefault: false,
    defaultUrl: "https://example.com/rules.yaml",
    defaultAction: "PROXY" as const,
    kind: "custom" as const,
  };
  const remote = "DOMAIN-SUFFIX,remote.example,PROXY";
  const local = "DOMAIN-SUFFIX,local.example,PROXY";

  assert.equal(normalizeRuleSourceStrategy(undefined), "subscription-first");
  assert.equal(buildRulePackContent(pack, {
    sourceStrategy: "subscription-first",
    cachedContent: remote,
    customContent: local,
  }).rulesText, remote);
  assert.equal(buildRulePackContent(pack, {
    sourceStrategy: "local-first",
    cachedContent: remote,
    customContent: local,
  }).rulesText, local);
  assert.equal(buildRulePackContent(pack, {
    sourceStrategy: "subscription-first",
    customContent: local,
  }).rulesText, "");
  assert.equal(buildRulePackContent(pack, {
    sourceStrategy: "local-first",
    cachedContent: remote,
  }).rulesText, "");
});

test("merge strategy combines remote and local rules and removes duplicates", () => {
  const result = buildRulePackContent({
    id: "merge-test",
    name: "Merge Test",
    description: "test",
    enabledByDefault: false,
    defaultUrl: "",
    defaultAction: "PROXY",
    kind: "custom",
  }, {
    sourceStrategy: "merge",
    cachedContent: "DOMAIN-SUFFIX,shared.example,PROXY",
    customContent: [
      "DOMAIN-SUFFIX,shared.example,PROXY",
      "DOMAIN-SUFFIX,local.example,PROXY",
    ].join("\n"),
  });

  assert.deepEqual(result.rulesText.split("\n"), [
    "DOMAIN-SUFFIX,shared.example,PROXY",
    "DOMAIN-SUFFIX,local.example,PROXY",
  ]);
});

test("proxy fallback sends unmatched websites to configured proxy", () => {
  const compiled = compileRulePacks(DEFAULT_RULE_PACKS, []);
  const pac = buildPacScript(compiled.rules, {
    host: "10.0.1.2",
    port: 6152,
  }, "PROXY");

  assert.match(pac.script, /return "PROXY 10\.0\.1\.2:6152";/);
  assert.doesNotMatch(pac.script, /return "DIRECT";/);
});

test("deduplicates rules and keeps the first conflicting action", () => {
  const catalog = [
    {
      id: "first",
      name: "First",
      description: "test",
      enabledByDefault: false,
      defaultUrl: "",
      defaultAction: "PROXY" as const,
      rulesText: `DOMAIN-SUFFIX,example.com,PROXY
DOMAIN,api.example.com,DIRECT`,
    },
    {
      id: "second",
      name: "Second",
      description: "test",
      enabledByDefault: false,
      defaultUrl: "",
      defaultAction: "DIRECT" as const,
      rulesText: `DOMAIN-SUFFIX,example.com,PROXY
DOMAIN,api.example.com,PROXY`,
    },
  ];
  const compiled = compileRulePacks(catalog, ["first", "second"]);

  assert.equal(compiled.rules.length, 2);
  assert.equal(compiled.statistics.parsed, 4);
  assert.equal(compiled.statistics.duplicates, 1);
  assert.equal(compiled.statistics.conflicts, 1);
  assert.deepEqual(compiled.conflicts[0], {
    key: "DOMAIN:api.example.com",
    keptAction: "DIRECT",
    ignoredAction: "PROXY",
    keptPackId: "first",
    ignoredPackId: "second",
  });
});

test("uses the same exact, suffix, and keyword semantics for diagnostics", () => {
  const rules = parseRules(`DOMAIN,api.example.com,DIRECT
DOMAIN-SUFFIX,google.com,PROXY
DOMAIN-KEYWORD,pinterest,PROXY`).rules;

  assert.equal(ruleMatchesHostname(rules[0], "api.example.com"), true);
  assert.equal(ruleMatchesHostname(rules[0], "www.api.example.com"), false);
  assert.equal(ruleMatchesHostname(rules[1], "mail.google.com"), true);
  assert.equal(ruleMatchesHostname(rules[2], "www.pinterest.de"), true);
});

test("custom catalog order overrides a conflicting managed rule", () => {
  const custom = {
    id: "custom-github-direct",
    name: "Custom GitHub Direct",
    description: "test",
    enabledByDefault: false,
    defaultUrl: "",
    defaultAction: "DIRECT" as const,
    rulesText: "DOMAIN-SUFFIX,github.com,DIRECT",
  };
  const compiled = compileRulePacks(
    [custom, ...DEFAULT_RULE_PACKS, ...BUILTIN_RULE_PACKS],
    [custom.id, ...DEFAULT_ENABLED_RULE_PACK_IDS],
  );
  const github = compiled.rules.find((rule) => rule.type === "DOMAIN-SUFFIX" && rule.value === "github.com");
  assert.equal(github?.action, "DIRECT");
});
