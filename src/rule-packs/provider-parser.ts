export function analyzeProviderRules(
  content: string,
  action: "DIRECT" | "PROXY",
): { rulesText: string; ignored: number } {
  const rules: string[] = [];
  let ignored = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();

    if (!line || line.startsWith("#") || line === "payload:") {
      continue;
    }

    if (line.startsWith("- ")) {
      line = line.slice(2).trim();
    }

    if (
      (line.startsWith("'") && line.endsWith("'")) ||
      (line.startsWith('"') && line.endsWith('"'))
    ) {
      line = line.slice(1, -1).trim();
    }

    if (line.startsWith("+.")) {
      rules.push(`DOMAIN-SUFFIX,${line.slice(2)},${action}`);
      continue;
    }

    if (!line.includes(",") && !line.startsWith("regexp:")) {
      rules.push(`DOMAIN,${line},${action}`);
    } else {
      ignored += 1;
    }
  }

  return { rulesText: rules.join("\n"), ignored };
}

export function normalizeProviderRules(
  content: string,
  action: "DIRECT" | "PROXY",
): string {
  return analyzeProviderRules(content, action).rulesText;
}
