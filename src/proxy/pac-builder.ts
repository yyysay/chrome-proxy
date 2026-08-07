import type {
  ParsedRule,
  RuleAction,
} from "../rules/types";

export interface PacProxyConfig {
  host: string;
  port: number;
}

export interface PacBuildResult {
  script: string;
  warnings: string[];
}

export function ruleMatchesHostname(rule: ParsedRule, hostname: string): boolean {
  const host = hostname.toLowerCase();

  switch (rule.type) {
    case "DOMAIN":
      return host === rule.value;
    case "DOMAIN-SUFFIX":
      return host === rule.value || host.endsWith(`.${rule.value}`);
    case "DOMAIN-KEYWORD":
      return host.includes(rule.value);
  }
}

function getPacResult(
  action: RuleAction,
  proxy: PacProxyConfig,
): string | null {
  switch (action) {
    case "PROXY":
      return `PROXY ${proxy.host}:${proxy.port}`;

    case "DIRECT":
      return "DIRECT";

    case "REJECT":
      // PAC 没有标准 REJECT 返回值。
      return null;
  }
}

export function buildPacScript(
  rules: ParsedRule[],
  proxy: PacProxyConfig,
  fallbackAction: "DIRECT" | "PROXY",
  forcedProxyHosts: readonly string[] = [],
): PacBuildResult {
  const warnings: string[] = [];

  const lines: string[] = [
    "function FindProxyForURL(url, host) {",
    "  host = host.toLowerCase();",
  ];

  const forcedProxyResult = JSON.stringify(`PROXY ${proxy.host}:${proxy.port}`);
  for (const value of forcedProxyHosts) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    const domain = JSON.stringify(normalized);
    const suffix = JSON.stringify(`.${normalized}`);
    lines.push(`  if (host === ${domain} || dnsDomainIs(host, ${suffix})) return ${forcedProxyResult};`);
  }

  for (const rule of rules) {
    const result = getPacResult(rule.action, proxy);

    if (!result) {
      warnings.push(
        `第 ${rule.lineNumber} 行的 REJECT 暂不支持，已跳过`,
      );

      continue;
    }

    const serializedResult = JSON.stringify(result);

    switch (rule.type) {
      case "DOMAIN": {
        const domain = JSON.stringify(rule.value);

        lines.push(
          `  if (host === ${domain}) return ${serializedResult};`,
        );

        break;
      }

      case "DOMAIN-SUFFIX": {
        const domain = JSON.stringify(rule.value);
        const suffix = JSON.stringify(`.${rule.value}`);

        lines.push(
          `  if (host === ${domain} || dnsDomainIs(host, ${suffix})) return ${serializedResult};`,
        );

        break;
      }

      case "DOMAIN-KEYWORD": {
        const keyword = JSON.stringify(rule.value);

        lines.push(
          `  if (host.indexOf(${keyword}) !== -1) return ${serializedResult};`,
        );

        break;
      }

    }
  }

  const fallbackResult = getPacResult(fallbackAction, proxy);
  lines.push(`  return ${JSON.stringify(fallbackResult)};`);

  lines.push("}");

  return {
    script: lines.join("\n"),
    warnings,
  };
}
