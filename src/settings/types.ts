import type { RuleSourceStrategy } from "../shared/runtime-protocol.ts";

export interface RulePackSetting {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  defaultAction: "DIRECT" | "PROXY";
  category: "builtin" | "default" | "custom";
  managed: boolean;
  customized?: boolean;
  enabled: boolean;
  sourceStrategy?: RuleSourceStrategy;
  source: {
    sourceStrategy?: RuleSourceStrategy;
    url?: string;
    cachedContent?: string;
    customContent?: string;
    updatedAt?: string;
    modifiedAt?: string;
    lastAttemptAt?: string;
    status?: "idle" | "downloading" | "ready" | "cached" | "error";
    error?: string;
  };
  validation?: { effective: number; ignored: number };
}
