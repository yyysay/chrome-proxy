export type RuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "DOMAIN-KEYWORD"
  | "MATCH";

export type RuleAction =
  | "PROXY"
  | "DIRECT"
  | "REJECT";

export interface ParsedRule {
  type: RuleType;
  value?: string;
  action: RuleAction;
  lineNumber: number;
  source: string;
}

export interface ParseIssue {
  lineNumber: number;
  source: string;
  message: string;
}

export interface ParseResult {
  rules: ParsedRule[];
  issues: ParseIssue[];
}