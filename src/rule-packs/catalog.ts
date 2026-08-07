import type { RulePackDefinition } from "./types";

export const DEFAULT_RULE_PACKS: readonly RulePackDefinition[] = [
  {
    id: "managed-pinterest",
    name: "Pinterest",
    description: "Auto Proxy 默认维护的 Pinterest 分流规则",
    enabledByDefault: true,
    defaultUrl: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/pinterest.yaml",
    defaultAction: "PROXY",
    kind: "managed",
    // 远程订阅不可用时仍保留一份最小可用规则。
    rulesText: [
      "DOMAIN-KEYWORD,pinterest,PROXY",
      "DOMAIN-SUFFIX,pinimg.com,PROXY",
    ].join("\n"),
  },
  {
    id: "managed-github",
    name: "GitHub",
    description: "Auto Proxy 默认维护的 GitHub 分流规则",
    enabledByDefault: true,
    defaultUrl: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml",
    defaultAction: "PROXY",
    kind: "managed",
    rulesText: [
      "DOMAIN-SUFFIX,github.com,PROXY",
      "DOMAIN-SUFFIX,githubusercontent.com,PROXY",
      "DOMAIN-SUFFIX,githubassets.com,PROXY",
      "DOMAIN-SUFFIX,github.io,PROXY",
    ].join("\n"),
  },
];

export const MANAGED_RULE_PACK_IDS: readonly string[] =
  DEFAULT_RULE_PACKS.map((pack) => pack.id);

// 兼容已有测试/调用方；Managed Rules 永远启用。
export const DEFAULT_ENABLED_RULE_PACK_IDS: readonly string[] = [...MANAGED_RULE_PACK_IDS];
