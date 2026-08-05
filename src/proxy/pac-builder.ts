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
): PacBuildResult {
  const warnings: string[] = [];

  const lines: string[] = [
    "function FindProxyForURL(url, host) {",
    "  host = host.toLowerCase();",
  ];

  let hasFinalRule = false;

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

      case "MATCH": {
        lines.push(`  return ${serializedResult};`);
        hasFinalRule = true;
        break;
      }
    }

    if (hasFinalRule) {
      break;
    }
  }

  if (!hasFinalRule) {
    lines.push('  return "DIRECT";');
  }

  lines.push("}");

  return {
    script: lines.join("\n"),
    warnings,
  };
}