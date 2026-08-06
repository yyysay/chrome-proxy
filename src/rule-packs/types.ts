import type { ParsedRule, ParseIssue } from "../rules/types";

export interface RulePackDefinition {
  id: string;
  name: string;
  description: string;
  enabledByDefault: boolean;
  defaultUrl: string;
  defaultAction: "DIRECT" | "PROXY";
  rulesText?: string;
}

export interface RulePackSourceState {
  url?: string;
  cachedContent?: string;
  customContent?: string;
  updatedAt?: string;
  lastAttemptAt?: string;
  status?: "idle" | "downloading" | "ready" | "cached" | "error";
  error?: string;
}

export interface CompiledRulePacks {
  rules: ParsedRule[];
  issues: Array<ParseIssue & { packId: string; packName: string }>;
  conflicts: Array<{
    key: string;
    keptAction: "DIRECT" | "PROXY" | "REJECT";
    ignoredAction: "DIRECT" | "PROXY" | "REJECT";
    keptPackId: string;
    ignoredPackId: string;
  }>;
  statistics: {
    parsed: number;
    effective: number;
    duplicates: number;
    conflicts: number;
    issues: number;
  };
  enabledPackIds: string[];
}
