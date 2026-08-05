import type {
  ParsedRule,
  ParseIssue,
  ParseResult,
  RuleAction,
  RuleType,
} from "./types";

const SUPPORTED_TYPES = new Set([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "MATCH",
  "FINAL",
]);

function normalizeLine(rawLine: string): string {
  let line = rawLine.replace(/^\uFEFF/, "").trim();

  // Mihomo YAML：
  // - DOMAIN-SUFFIX,example.com,PROXY
  // - 'DOMAIN-SUFFIX,example.com'
  if (line.startsWith("- ")) {
    line = line.slice(2).trim();
  }

  const isSingleQuoted =
    line.startsWith("'") && line.endsWith("'");

  const isDoubleQuoted =
    line.startsWith('"') && line.endsWith('"');

  if (isSingleQuoted || isDoubleQuoted) {
    line = line.slice(1, -1).trim();
  }

  return line;
}

function shouldIgnoreLine(line: string): boolean {
  if (line.length === 0) {
    return true;
  }

  if (
    line.startsWith("!") ||
    line.startsWith("#") ||
    line.startsWith(";") ||
    line.startsWith("//")
  ) {
    return true;
  }

  const normalized = line.toLowerCase();

  if (
    normalized === "[rule]" ||
    normalized === "rules:" ||
    normalized === "payload:"
  ) {
    return true;
  }

  return false;
}

function normalizeRuleValue(
  rawType: string,
  value?: string,
): string | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (rawType === "DOMAIN-SUFFIX") {
    return normalized.replace(/^\.+/, "");
  }

  return normalized;
}

function isValidRuleValue(type: string, value: string): boolean {
  if (type === "DOMAIN-KEYWORD") {
    return !/\s/.test(value);
  }

  return (
    value.length <= 253 &&
    !/\s|\/|:/.test(value) &&
    value.split(".").every((label) => (
      label.length > 0 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-z0-9_-]+$/i.test(label)
    ))
  );
}

function normalizeAction(policy?: string): RuleAction {
  const value = policy?.trim().toUpperCase();

  if (value === "DIRECT") {
    return "DIRECT";
  }

  if (
    value === "REJECT" ||
    value === "REJECT-DROP"
  ) {
    return "REJECT";
  }

  // PROXY、节点名称、策略组名称均先映射到本地代理。
  return "PROXY";
}

function createIssue(
  lineNumber: number,
  source: string,
  message: string,
): ParseIssue {
  return {
    lineNumber,
    source,
    message,
  };
}

export function parseRules(text: string): ParseResult {
  const rules: ParsedRule[] = [];
  const issues: ParseIssue[] = [];

  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = normalizeLine(rawLine);

    if (shouldIgnoreLine(line)) {
      return;
    }

    const parts = line
      .split(",")
      .map((part) => part.trim());

    const rawType = parts[0]?.toUpperCase();

    if (!rawType || !SUPPORTED_TYPES.has(rawType)) {
      issues.push(
        createIssue(
          lineNumber,
          rawLine,
          `暂不支持的规则类型：${rawType || "空"}`,
        ),
      );

      return;
    }

    if (rawType === "MATCH" || rawType === "FINAL") {
      rules.push({
        type: "MATCH",
        action: normalizeAction(parts[1]),
        lineNumber,
        source: rawLine,
      });

      return;
    }

    const value = normalizeRuleValue(rawType, parts[1]);

    if (!value) {
      issues.push(
        createIssue(
          lineNumber,
          rawLine,
          "规则缺少匹配内容",
        ),
      );

      return;
    }

    if (!isValidRuleValue(rawType, value)) {
      issues.push(
        createIssue(
          lineNumber,
          rawLine,
          `无效的匹配内容：${value}`,
        ),
      );

      return;
    }

    rules.push({
      type: rawType as RuleType,
      value,
      action: normalizeAction(parts[2]),
      lineNumber,
      source: rawLine,
    });
  });

  return {
    rules,
    issues,
  };
}
