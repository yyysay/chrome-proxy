import type { ParsedRule, ParseIssue } from "../rules/types";

export interface RulePackDefinition {
  id: string;
  name: string;
  description: string;
  enabledByDefault: boolean;
  rulesText: string;
}

export interface CompiledRulePacks {
  rules: ParsedRule[];
  issues: Array<ParseIssue & { packId: string; packName: string }>;
  enabledPackIds: string[];
}
