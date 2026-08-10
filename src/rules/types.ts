export type RuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "IP-CIDR";

export interface ParsedRule {
  type: RuleType;
  value: string;
}
