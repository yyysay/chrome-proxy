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
];

export const BUILTIN_RULE_PACKS: readonly RulePackDefinition[] = [
  {
    id: "builtin-local-direct",
    name: "本地网络直连",
    description: "常见本地主机与 IPv4 内网网段默认直连，可由更靠前的规则覆盖",
    enabledByDefault: true,
    defaultUrl: "",
    defaultAction: "DIRECT",
    kind: "builtin",
    rulesText: [
      "DOMAIN-SUFFIX,localhost,DIRECT",
      "DOMAIN-SUFFIX,local,DIRECT",
      "IP-CIDR,127.0.0.0/8,DIRECT",
      "IP-CIDR,10.0.0.0/8,DIRECT",
      "IP-CIDR,172.16.0.0/12,DIRECT",
      "IP-CIDR,192.168.0.0/16,DIRECT",
      "IP-CIDR,169.254.0.0/16,DIRECT",
    ].join("\n"),
  },
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
