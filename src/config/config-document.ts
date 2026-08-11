import { parseDocument, stringify } from "yaml";
import { parseRules } from "../rules/parser.ts";

export const SAMPLE_CONFIG_YAML = `proxies:
  - name: 香港
    type: http
    server: 10.0.0.10
    port: 7890

  - name: 日本
    type: http
    server: 10.0.0.11
    port: 7890

rules:
  - RULE-SET,private-network,DIRECT
  - RULE-SET,pinterest,香港
  - DOMAIN-SUFFIX,example.com,日本
  - MATCH,香港

rule-providers:
  pinterest:
    url: https://example.com/pinterest.yaml
    behavior: domain
    format: yaml
    interval: 86400

  private-network:
    url: https://example.com/private.list
    behavior: ipcidr
    format: list
    interval: 86400
`;

const RULE_BEHAVIORS = new Set(["domain", "ipcidr", "classical"]);
const RULE_FORMATS = new Set(["yaml", "list"]);
const LOCAL_RULE_TYPES = new Set([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "IP-CIDR",
]);
const MAX_CONFIG_BYTES = 256 * 1024;

type ConfigRuleBehavior = "domain" | "ipcidr" | "classical";
type ConfigRuleFormat = "yaml" | "list";

export interface ConfigProxyNode {
  name: string;
  type: "http";
  server: string;
  port: number;
}

export interface ConfigRuleProvider {
  name: string;
  url: string;
  behavior: ConfigRuleBehavior;
  format: ConfigRuleFormat;
  interval: number;
}

export interface MinimalConfigDocument {
  proxies: ConfigProxyNode[];
  ruleProviders: Record<string, ConfigRuleProvider>;
  rules: string[];
}

const DISABLED_RULE_PATTERN = /^\s*#\s*disabled-rule:\s*(.+?)\s*$/gmi;

export function extractDisabledConfigRules(text: string): string[] {
  return Array.from(text.matchAll(DISABLED_RULE_PATTERN), (match) => match[1].trim())
    .filter(Boolean);
}

export function serializeConfigDocument(document: MinimalConfigDocument, disabledRules: readonly string[] = []): string {
  const providers = Object.fromEntries(Object.values(document.ruleProviders).map((provider) => [
    provider.name,
    {
      type: "http",
      url: provider.url,
      behavior: provider.behavior,
      format: provider.format,
      interval: provider.interval,
    },
  ]));
  const yaml = stringify({
    proxies: document.proxies,
    rules: document.rules,
    "rule-providers": providers,
  }, { lineWidth: 0 });
  if (disabledRules.length === 0) return yaml;
  const lines = yaml.trimEnd().split("\n");
  const rulesIndex = lines.findIndex((line) => line === "rules:");
  const matchIndex = lines.findIndex((line, index) => index > rulesIndex && /^\s*-\s+MATCH,/.test(line));
  const insertAt = matchIndex >= 0 ? matchIndex : lines.length;
  lines.splice(insertAt, 0, ...disabledRules.map((rule) => `  # disabled-rule: ${rule}`));
  return `${lines.join("\n")}\n`;
}

interface ConfigSummary {
  proxies: number;
  ruleProviders: number;
  localRules: number;
  matchTarget: string;
}

interface ConfigValidationResult {
  ok: boolean;
  issues: string[];
  summary?: ConfigSummary;
  document?: MinimalConfigDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateServer(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !value.includes("://") && !value.includes("/") && !/\s/.test(value);
}

function validateHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseYaml(text: string): { value?: unknown; issues: string[] } {
  if (!text.trim()) return { issues: ["配置内容不能为空"] };
  if (new TextEncoder().encode(text).byteLength > MAX_CONFIG_BYTES) {
    return { issues: ["配置文件超过 256 KB 限制"] };
  }
  try {
    const document = parseDocument(text, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      return { issues: document.errors.map((error) => error.message) };
    }
    return { value: document.toJS({ maxAliasCount: 50 }), issues: [] };
  } catch (error) {
    return {
      issues: [error instanceof Error ? error.message : "YAML 解析失败"],
    };
  }
}

export function validateConfigDocument(text: string): ConfigValidationResult {
  const parsed = parseYaml(text);
  if (parsed.issues.length > 0) return { ok: false, issues: parsed.issues };
  if (!isRecord(parsed.value)) return { ok: false, issues: ["配置根节点必须是 YAML 对象"] };

  const issues: string[] = [];
  const proxyNames = new Set<string>();
  const proxies: ConfigProxyNode[] = [];
  const rawProxies = parsed.value.proxies;

  if (!Array.isArray(rawProxies) || rawProxies.length === 0) {
    issues.push("proxies 至少需要一个 HTTP 节点");
  } else {
    rawProxies.forEach((rawNode, index) => {
      const label = `proxies[${index}]`;
      if (!isRecord(rawNode)) {
        issues.push(`${label} 必须是对象`);
        return;
      }
      const name = typeof rawNode.name === "string" ? rawNode.name.trim() : "";
      if (!name) {
        issues.push(`${label}.name 不能为空`);
      } else if (name.includes(",")) {
        issues.push(`${label}.name 不能包含逗号`);
      } else if (name === "DIRECT" || name === "REJECT") {
        issues.push(`${label}.name 不能使用保留名称 ${name}`);
      } else if (proxyNames.has(name)) {
        issues.push(`代理节点名称重复：${name}`);
      } else {
        proxyNames.add(name);
      }
      if (rawNode.type !== "http") issues.push(`${label}.type 目前只支持 http`);
      if (!validateServer(rawNode.server)) issues.push(`${label}.server 不是有效的主机名或 IP`);
      if (!Number.isInteger(rawNode.port) || Number(rawNode.port) < 1 || Number(rawNode.port) > 65535) {
        issues.push(`${label}.port 必须是 1 到 65535 的整数`);
      }
      if (name && rawNode.type === "http" && validateServer(rawNode.server) &&
          Number.isInteger(rawNode.port) && Number(rawNode.port) >= 1 && Number(rawNode.port) <= 65535) {
        proxies.push({
          name,
          type: "http",
          server: rawNode.server.trim(),
          port: Number(rawNode.port),
        });
      }
    });
  }

  const providerNames = new Set<string>();
  const ruleProviders: Record<string, ConfigRuleProvider> = {};
  const rawProviders = parsed.value["rule-providers"];
  if (rawProviders !== undefined && !isRecord(rawProviders)) {
    issues.push("rule-providers 必须是对象");
  } else if (isRecord(rawProviders)) {
    for (const [name, rawProvider] of Object.entries(rawProviders)) {
      const label = `rule-providers.${name}`;
      if (!name.trim() || name.includes(",")) {
        issues.push("规则包名称不能为空且不能包含逗号");
        continue;
      }
      providerNames.add(name);
      if (!isRecord(rawProvider)) {
        issues.push(`${label} 必须是对象`);
        continue;
      }
      if (rawProvider.type !== undefined && rawProvider.type !== "http") {
        issues.push(`${label}.type 目前只支持 http`);
      }
      if (!validateHttpUrl(rawProvider.url)) issues.push(`${label}.url 必须是 HTTP/HTTPS 地址`);
      if (!RULE_BEHAVIORS.has(String(rawProvider.behavior))) {
        issues.push(`${label}.behavior 仅支持 domain、ipcidr 或 classical`);
      }
      const format = rawProvider.format ?? "yaml";
      if (!RULE_FORMATS.has(String(format))) issues.push(`${label}.format 仅支持 yaml 或 list`);
      if (rawProvider.interval !== undefined &&
          (!Number.isInteger(rawProvider.interval) || Number(rawProvider.interval) < 1)) {
        issues.push(`${label}.interval 必须是正整数秒`);
      }
      if (validateHttpUrl(rawProvider.url) && RULE_BEHAVIORS.has(String(rawProvider.behavior)) &&
          RULE_FORMATS.has(String(format)) &&
          (rawProvider.interval === undefined ||
            (Number.isInteger(rawProvider.interval) && Number(rawProvider.interval) >= 1))) {
        ruleProviders[name] = {
          name,
          url: rawProvider.url,
          behavior: String(rawProvider.behavior) as ConfigRuleBehavior,
          format: String(format) as ConfigRuleFormat,
          interval: rawProvider.interval === undefined ? 86_400 : Number(rawProvider.interval),
        };
      }
    }
  }

  const rawRules = parsed.value.rules;
  const rules: string[] = [];
  let localRules = 0;
  let matchTarget = "";
  let matchCount = 0;
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    issues.push("rules 至少需要一条规则，并以 MATCH 结尾");
  } else {
    rawRules.forEach((rawRule, index) => {
      const label = `rules[${index}]`;
      if (typeof rawRule !== "string" || !rawRule.trim()) {
        issues.push(`${label} 必须是非空字符串`);
        return;
      }
      rules.push(rawRule.trim());
      const parts = rawRule.split(",").map((part) => part.trim());
      const type = parts[0]?.toUpperCase();
      const target = type === "MATCH" ? parts[1] : parts[2];

      if (type === "RULE-SET") {
        if (parts.length !== 3 || !parts[1]) {
          issues.push(`${label} 应写为 RULE-SET,规则包名称,节点名称`);
          return;
        }
        if (!providerNames.has(parts[1])) issues.push(`${label} 引用了不存在的规则包：${parts[1]}`);
      } else if (type === "MATCH") {
        matchCount += 1;
        if (parts.length !== 2) issues.push(`${label} 应写为 MATCH,节点名称`);
        if (index !== rawRules.length - 1) issues.push("MATCH 必须是最后一条规则");
        matchTarget = parts[1] ?? "";
      } else if (type && LOCAL_RULE_TYPES.has(type)) {
        if (parts.length !== 3) {
          issues.push(`${label} 应包含规则类型、匹配内容和目标节点`);
        } else {
          const parsedRule = parseRules(rawRule);
          if (parsedRule.issues.length > 0) issues.push(`${label}：${parsedRule.issues[0].message}`);
        }
        localRules += 1;
      } else {
        issues.push(`${label} 使用了暂不支持的规则类型：${type || "空"}`);
        return;
      }

      if (target === "REJECT") {
        issues.push(`${label}：不支持 REJECT`);
      } else if (target !== "DIRECT" && !proxyNames.has(target ?? "")) {
        issues.push(`${label} 引用了不存在的代理节点：${target || "空"}`);
      }
    });
    if (matchCount !== 1) issues.push("rules 必须且只能包含一条 MATCH 兜底规则");
    else if (!matchTarget) issues.push("rules 必须以 MATCH 规则结尾");
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? {
          proxies: proxyNames.size,
          ruleProviders: providerNames.size,
          localRules,
          matchTarget,
        }
      : undefined,
    document: issues.length === 0
      ? { proxies, ruleProviders, rules }
      : undefined,
  };
}
