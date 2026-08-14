export type RuntimeMessage =
  | { type: "ENABLE_PROXY" }
  | { type: "DISABLE_PROXY" }
  | { type: "GET_PROXY_STATUS" }
  | { type: "GET_CONFIG_DOCUMENT_STATE" }
  | { type: "GET_SITE_PROXY_STATUS"; input: string }
  | { type: "GET_ACTIVE_SITE_PROXY_STATUS" }
  | { type: "GET_CONFIG_PROVIDER_CONTENT"; name: string }
  | { type: "APPLY_CONFIG_DOCUMENT"; yaml: string; sourceUrl?: string; refreshIntervalSeconds?: number }
  | { type: "REFRESH_CONFIG_PROVIDERS" }
  | { type: "GET_NETWORK_INFO"; nodeName?: string }
  | { type: "TEST_RULE_MATCH"; input: string }
  | { type: "GET_DIAGNOSTIC_EVENTS" }
  | { type: "CLEAR_DIAGNOSTIC_EVENTS" };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface ActiveSiteProxyStatus {
  tabId: number;
  url: string;
  hostname: string;
  action: string;
  proxied: boolean;
  engineEnabled: boolean;
}

export interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}
