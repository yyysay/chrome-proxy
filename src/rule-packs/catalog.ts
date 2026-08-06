import type { RulePackDefinition } from "./types";

// 初始不提供任何内置规则，所有规则均由用户自行添加。
export const DEFAULT_RULE_PACKS: readonly RulePackDefinition[] = [];
export const DEFAULT_ENABLED_RULE_PACK_IDS: readonly string[] = [];
