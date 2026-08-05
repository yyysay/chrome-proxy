import { parseRules } from "../rules/parser.ts";
import type { ParsedRule } from "../rules/types";
import type {
  CompiledRulePacks,
  RulePackDefinition,
} from "./types";

export function compileRulePacks(
  catalog: readonly RulePackDefinition[],
  enabledPackIds: readonly string[],
  fallbackAction: "DIRECT" | "PROXY" = "DIRECT",
): CompiledRulePacks {
  const enabledIds = new Set(enabledPackIds);
  const rules: ParsedRule[] = [];
  const issues: CompiledRulePacks["issues"] = [];
  const compiledPackIds: string[] = [];

  for (const pack of catalog) {
    if (!enabledIds.has(pack.id)) {
      continue;
    }

    const parsed = parseRules(pack.rulesText);
    compiledPackIds.push(pack.id);
    rules.push(...parsed.rules);
    issues.push(
      ...parsed.issues.map((issue) => ({
        ...issue,
        packId: pack.id,
        packName: pack.name,
      })),
    );
  }

  rules.push({
    type: "MATCH",
    action: fallbackAction,
    lineNumber: 0,
    source: `系统兜底规则：MATCH,${fallbackAction}`,
  });

  return {
    rules,
    issues,
    enabledPackIds: compiledPackIds,
  };
}
