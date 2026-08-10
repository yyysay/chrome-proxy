import { parseDocument } from "yaml";
import { parseRules } from "../rules/parser.ts";
import type { RuleType } from "../rules/types.ts";
import type { ConfigRuleProvider } from "./config-document.ts";

interface ConfigProviderRule {
  type: RuleType;
  value: string;
}

function providerItems(provider: ConfigRuleProvider, content: string): string[] {
  if (provider.format === "list") {
    return content.split(/\r?\n/)
      .map((line, index) => (index === 0 ? line.replace(/^\uFEFF/, "") : line).trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") &&
        !line.startsWith(";") && !line.startsWith("//"));
  }

  const document = parseDocument(content, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) throw new Error(document.errors[0].message);
  const value = document.toJS({ maxAliasCount: 50 }) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YAML 规则包必须是包含 payload 的对象");
  }
  const payload = (value as Record<string, unknown>).payload;
  if (!Array.isArray(payload)) throw new Error("YAML 规则包缺少 payload 数组");
  return payload.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`payload[${index}] 必须是非空字符串`);
    }
    return entry.trim();
  });
}

function normalizeProviderItem(
  provider: ConfigRuleProvider,
  item: string,
  index: number,
): ConfigProviderRule {
  let ruleText: string;
  if (provider.behavior === "domain") {
    if (item.startsWith("+.")) {
      ruleText = `DOMAIN-SUFFIX,${item.slice(2)},PROXY`;
    } else if (item.startsWith(".")) {
      ruleText = `DOMAIN-SUFFIX,${item.slice(1)},PROXY`;
    } else {
      ruleText = `DOMAIN,${item},PROXY`;
    }
  } else if (provider.behavior === "ipcidr") {
    ruleText = `IP-CIDR,${item},PROXY`;
  } else {
    const parts = item.split(",").map((part) => part.trim());
    if (parts.length < 2) throw new Error(`第 ${index + 1} 条 classical 规则缺少匹配内容`);
    ruleText = `${parts[0]},${parts[1]},PROXY`;
  }

  const parsed = parseRules(ruleText);
  if (parsed.rules.length !== 1 || parsed.issues.length > 0) {
    throw new Error(`第 ${index + 1} 条规则无效：${parsed.issues[0]?.message ?? item}`);
  }
  return { type: parsed.rules[0].type, value: parsed.rules[0].value };
}

export function parseConfigRuleProvider(
  provider: ConfigRuleProvider,
  content: string,
): ConfigProviderRule[] {
  const items = providerItems(provider, content);
  const rules = items.map((item, index) => normalizeProviderItem(provider, item, index));
  if (rules.length === 0) throw new Error("规则包没有有效规则");
  return rules;
}
