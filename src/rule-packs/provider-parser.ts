function stripQuotedScalar(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function splitInlinePayload(value: string): string[] | undefined {
  const trimmed = value.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }

  // 规则值本身不会包含逗号；这里兼容 payload: [+.a.com, +.b.com]。
  return body.split(",").map(stripQuotedScalar).filter(Boolean);
}

function normalizeProviderEntry(
  rawValue: string,
  action: "DIRECT" | "PROXY",
): string | undefined {
  const value = stripQuotedScalar(rawValue);

  if (!value || value.startsWith("#")) {
    return undefined;
  }

  if (value.startsWith("+.")) {
    const domain = value.slice(2).trim();
    return domain ? `DOMAIN-SUFFIX,${domain},${action}` : undefined;
  }

  // 兼容常见 Clash provider 条目，不要求用户手动补 action。
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length >= 2 && (parts[0] === "DOMAIN" || parts[0] === "DOMAIN-SUFFIX")) {
    return parts[1] ? `${parts[0]},${parts[1]},${action}` : undefined;
  }

  // 最简单的输入方式：一行一个完整域名。
  if (!value.includes(",") && !value.startsWith("regexp:")) {
    return `DOMAIN,${value},${action}`;
  }

  return undefined;
}

export function analyzeProviderRules(
  content: string,
  action: "DIRECT" | "PROXY",
): { rulesText: string; ignored: number } {
  const rules: string[] = [];
  let ignored = 0;

  const append = (value: string): void => {
    const normalized = normalizeProviderEntry(value, action);
    if (normalized) {
      rules.push(normalized);
    } else if (value.trim()) {
      ignored += 1;
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line === "payload:") {
      continue;
    }

    if (line.startsWith("payload:")) {
      const payloadValue = line.slice("payload:".length).trim();
      const inlineValues = splitInlinePayload(payloadValue);

      if (inlineValues) {
        for (const value of inlineValues) {
          append(value);
        }
      } else if (payloadValue) {
        append(payloadValue);
      }
      continue;
    }

    if (line.startsWith("- ")) {
      line = line.slice(2).trim();
    }

    append(line);
  }

  return { rulesText: rules.join("\n"), ignored };
}

export function normalizeProviderRules(
  content: string,
  action: "DIRECT" | "PROXY",
): string {
  return analyzeProviderRules(content, action).rulesText;
}
