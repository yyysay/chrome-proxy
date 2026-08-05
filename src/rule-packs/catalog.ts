import type { RulePackDefinition } from "./types";

export const BUILTIN_RULE_PACKS: readonly RulePackDefinition[] = [
  {
    id: "google-direct-test",
    name: "Google 直连测试",
    description: "google.com 及其子域名使用直连。",
    enabledByDefault: false,
    rulesText: "DOMAIN-SUFFIX,google.com,DIRECT",
  },
  {
    id: "ip125-proxy-test",
    name: "IP125 代理测试",
    description: "ip125.com 及其子域名使用本地 HTTP 代理。",
    enabledByDefault: false,
    rulesText: "DOMAIN-SUFFIX,ip125.com,PROXY",
  },
  {
    id: "global-proxy-diagnostic",
    name: "全局代理诊断",
    description: "除前置直连规则外，其余网站全部使用代理；仅用于排查。",
    enabledByDefault: false,
    rulesText: "MATCH,PROXY",
  },
];

export const DEFAULT_ENABLED_RULE_PACK_IDS = BUILTIN_RULE_PACKS
  .filter((pack) => pack.enabledByDefault)
  .map((pack) => pack.id);
