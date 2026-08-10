import { reconcileProxy } from "../proxy/pac-controller.ts";
import { syncActionState } from "./action-state.ts";
import { recordDiagnosticEvent } from "./diagnostics.ts";

let reconcileTask: Promise<boolean> | undefined;
let forceReconcileQueued = false;

export function scheduleReconcile(reason: string, forceApply = false): void {
  if (reconcileTask) {
    forceReconcileQueued ||= forceApply;
    return;
  }

  reconcileTask = reconcileProxy(forceApply);

  void reconcileTask
    .catch((error: unknown) => {
      void recordDiagnosticEvent({
        type: "background",
        message: "代理状态同步失败",
        details: `${reason}：${error instanceof Error ? error.message : String(error)}`,
      });
    })
    .finally(() => {
      reconcileTask = undefined;
      void syncActionState().catch(() => undefined);

      if (forceReconcileQueued) {
        forceReconcileQueued = false;
        scheduleReconcile("proxyState.queuedChange", true);
      }
    });
}
