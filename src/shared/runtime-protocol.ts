export type ProxySourceMode = "subscription" | "manual";
export type FallbackMode = "direct" | "proxy" | "system";
export type RuleSourceStrategy = "local-first" | "subscription-first" | "merge";

export type RuntimeMessage =
  | { type: "ENABLE_PROXY" }
  | { type: "DISABLE_PROXY" }
  | { type: "GET_PROXY_STATUS" }
  | { type: "GET_PROXY_PROVIDER_STATE" }
  | { type: "SET_PROXY_SOURCE_MODE"; mode: ProxySourceMode }
  | { type: "SAVE_MANUAL_PROXY"; host: string; port: number }
  | { type: "SAVE_PROXY_SUBSCRIPTION"; url: string }
  | { type: "REFRESH_PROXY_SUBSCRIPTION" }
  | { type: "UPDATE_PROXY_SUBSCRIPTION_REFRESH"; intervalMinutes: number }
  | { type: "UPDATE_RULE_PACKS"; enabledPackIds: string[] }
  | { type: "UPDATE_FALLBACK_MODE"; fallbackMode: FallbackMode }
  | { type: "GET_NETWORK_INFO" }
  | { type: "GET_RULE_PACK_SETTINGS" }
  | { type: "REFRESH_RULE_PACK"; packId: string }
  | { type: "RESET_MANAGED_RULE_PACK"; packId: string }
  | {
      type: "SAVE_RULE_PACK";
      packId?: string;
      name: string;
      url: string;
      action: "DIRECT" | "PROXY";
      customContent: string;
      sourceStrategy: RuleSourceStrategy;
    }
  | { type: "DELETE_RULE_PACK"; packId: string }
  | {
      type: "UPDATE_RULE_AUTO_REFRESH";
      enabled: boolean;
      intervalMinutes: number;
    }
  | { type: "TEST_RULE_MATCH"; input: string }
  | { type: "REFRESH_ENABLED_RULE_PACKS" }
  | { type: "GET_DIAGNOSTIC_EVENTS" }
  | { type: "CLEAR_DIAGNOSTIC_EVENTS" };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}
