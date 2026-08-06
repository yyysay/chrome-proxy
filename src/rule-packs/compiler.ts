import { parseRules } from "../rules/parser.ts";
import type { ParsedRule } from "../rules/types";
import type {
  CompiledRulePacks,
  RulePackDefinition,
} from "./types";

export function compileRulePacks(
  catalog: readonly RulePackDefinition[],
  enabledPackIds: readonly string[],
): CompiledRulePacks {
  const enabledIds = new Set(enabledPackIds);
  const rules: ParsedRule[] = [];
  const issues: CompiledRulePacks["issues"] = [];
  const conflicts: CompiledRulePacks["conflicts"] = [];
  const compiledPackIds: string[] = [];
  const seen = new Map<string, { rule: ParsedRule; packId: string }>();
  let parsedCount = 0;
  let duplicateCount = 0;

  for (const pack of catalog) {
    if (!enabledIds.has(pack.id)) {
      continue;
    }

    const parsed = parseRules(pack.rulesText ?? "");
    compiledPackIds.push(pack.id);
    parsedCount += parsed.rules.length;

    for (const rule of parsed.rules) {
      const key = `${rule.type}:${rule.value}`;
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, { rule, packId: pack.id });
        rules.push(rule);
        continue;
      }

      if (existing.rule.action === rule.action) {
        duplicateCount += 1;
        continue;
      }

      conflicts.push({
        key,
        keptAction: existing.rule.action,
        ignoredAction: rule.action,
        keptPackId: existing.packId,
        ignoredPackId: pack.id,
      });
    }
    issues.push(
      ...parsed.issues.map((issue) => ({
        ...issue,
        packId: pack.id,
        packName: pack.name,
      })),
    );
  }

  return {
    rules,
    issues,
    conflicts,
    statistics: {
      parsed: parsedCount,
      effective: rules.length,
      duplicates: duplicateCount,
      conflicts: conflicts.length,
      issues: issues.length,
    },
    enabledPackIds: compiledPackIds,
  };
}
