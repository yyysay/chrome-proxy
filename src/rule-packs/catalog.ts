import type { RulePackDefinition } from "./types";

export const DEFAULT_RULE_PACKS: readonly RulePackDefinition[] = [
  {
    id: "managed-pinterest",
    name: "Pinterest",
    description: "预设的 Pinterest 远程规则订阅",
    enabledByDefault: true,
    defaultUrl: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/pinterest.yaml",
    defaultAction: "PROXY",
    kind: "managed",
  },
  {
    id: "managed-proxy",
    name: "Custom Proxy",
    description: "预设的代理远程规则订阅",
    enabledByDefault: true,
    defaultUrl: "https://dufs.ms.y3-3am.top/clash-rules/domain/custom-proxy.yaml",
    defaultAction: "PROXY",
    kind: "managed",
  },
];

export const BUILTIN_RULE_PACKS: readonly RulePackDefinition[] = [
  {
    id: "builtin-core-proxy",
    name: "基础代理规则",
    description: "随扩展发布，远程规则暂不可用时仍保留基础分流",
    enabledByDefault: true,
    defaultUrl: "",
    defaultAction: "PROXY",
    kind: "builtin",
    rulesText: [
      "DOMAIN,raw.githubusercontent.com,PROXY",
    ].join("\n"),
  },
];

export const MANAGED_RULE_PACK_IDS: readonly string[] =
  DEFAULT_RULE_PACKS.map((pack) => pack.id);

export const BUILTIN_RULE_PACK_IDS: readonly string[] =
  BUILTIN_RULE_PACKS.map((pack) => pack.id);

// 兼容已有测试/调用方；默认订阅初始启用，内置规则始终启用。
export const DEFAULT_ENABLED_RULE_PACK_IDS: readonly string[] = [
  ...MANAGED_RULE_PACK_IDS,
  ...BUILTIN_RULE_PACK_IDS,
];
