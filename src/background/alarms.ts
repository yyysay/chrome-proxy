import {
  CONFIG_PROVIDER_REFRESH_ALARM,
  REMOTE_CONFIG_REFRESH_ALARM,
  refreshConfigDocumentProviders,
  refreshRemoteConfigDocument,
} from "../config/config-runtime.ts";
import { reconcileProxy } from "../proxy/pac-controller.ts";
import { syncActionState } from "./action-state.ts";
import { recordDiagnosticEvent } from "./diagnostics.ts";
import { clearTabRequestRouteStates } from "./request-route-state.ts";

let refreshQueue: Promise<void> = Promise.resolve();

export function handleRefreshAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name !== CONFIG_PROVIDER_REFRESH_ALARM && alarm.name !== REMOTE_CONFIG_REFRESH_ALARM) return;
  const refresh = alarm.name === REMOTE_CONFIG_REFRESH_ALARM
    ? refreshRemoteConfigDocument
    : () => refreshConfigDocumentProviders(true);
  refreshQueue = refreshQueue.catch(() => undefined).then(async () => {
      await refresh();
      await reconcileProxy(true);
      await clearTabRequestRouteStates();
      await syncActionState();
    });
  void refreshQueue.catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "subscription",
        message: alarm.name === REMOTE_CONFIG_REFRESH_ALARM
          ? "远程 YAML 自动更新失败"
          : "配置规则包自动更新失败",
        details: error instanceof Error ? error.message : String(error),
      });
    });
}
