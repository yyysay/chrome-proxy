import {
  CONFIG_PROVIDER_REFRESH_ALARM,
  refreshConfigDocumentProviders,
} from "../config/config-runtime.ts";
import { reconcileProxy } from "../proxy/pac-controller.ts";
import { recordDiagnosticEvent } from "./diagnostics.ts";

export function handleRefreshAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name !== CONFIG_PROVIDER_REFRESH_ALARM) return;
  void refreshConfigDocumentProviders()
    .then(() => reconcileProxy(true))
    .catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "subscription",
        message: "配置规则包自动更新失败",
        details: error instanceof Error ? error.message : String(error),
      });
    });
}
