import type { ParsedRule } from "../rules/types";
import { ipMatchesCidr } from "../rules/ip-cidr.ts";

interface PacProxyConfig {
  host: string;
  port: number;
}

export interface PacTargetedRule {
  type: ParsedRule["type"];
  value: string;
  target: string;
}

export function ruleMatchesHostname(rule: ParsedRule, hostname: string): boolean {
  const host = hostname.toLowerCase();

  switch (rule.type) {
    case "DOMAIN":
      return host === rule.value;
    case "DOMAIN-SUFFIX":
      return host === rule.value || host.endsWith(`.${rule.value}`);
    case "IP-CIDR":
      return ipMatchesCidr(host, rule.value);
  }
}

function appendRuleCondition(
  lines: string[],
  rule: Pick<ParsedRule, "type" | "value">,
  result: string,
): void {
  const serializedResult = JSON.stringify(result);

  switch (rule.type) {
    case "DOMAIN": {
      const domain = JSON.stringify(rule.value);
      lines.push(`  if (host === ${domain}) return ${serializedResult};`);
      break;
    }

    case "DOMAIN-SUFFIX": {
      const domain = JSON.stringify(rule.value);
      const suffix = JSON.stringify(`.${rule.value}`);
      lines.push(`  if (host === ${domain} || dnsDomainIs(host, ${suffix})) return ${serializedResult};`);
      break;
    }

    case "IP-CIDR": {
      lines.push(`  if (isInNetEx(host, ${JSON.stringify(rule.value)})) return ${serializedResult};`);
      break;
    }
  }
}

export function buildTargetedPacScript(
  rules: readonly PacTargetedRule[],
  proxies: ReadonlyMap<string, PacProxyConfig>,
  fallbackTarget: string,
  forcedProxyHosts: readonly string[] = [],
): string {
  const resultForTarget = (target: string): string => {
    if (target === "DIRECT") return "DIRECT";
    const proxy = proxies.get(target);
    if (!proxy) throw new Error(`PAC 引用了不存在的代理节点：${target}`);
    return `PROXY ${proxy.host}:${proxy.port}`;
  };
  const fallbackResult = resultForTarget(fallbackTarget);
  const lines = [
    "function FindProxyForURL(url, host) {",
    "  host = host.toLowerCase();",
  ];

  for (const value of forcedProxyHosts) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    const domain = JSON.stringify(normalized);
    const suffix = JSON.stringify(`.${normalized}`);
    lines.push(`  if (host === ${domain} || dnsDomainIs(host, ${suffix})) return ${JSON.stringify(fallbackResult)};`);
  }

  for (const rule of rules) {
    appendRuleCondition(lines, rule, resultForTarget(rule.target));
  }
  lines.push(`  return ${JSON.stringify(fallbackResult)};`);
  lines.push("}");
  return lines.join("\n");
}
