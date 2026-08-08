import type { DiagnosticEvent } from "../shared/runtime-protocol.ts";
import { requiredElement } from "./dom.ts";
import { setRelativeTimeStatus } from "./relative-time.ts";
import { sendMessage } from "./runtime-client.ts";
import { showToast } from "./toast.ts";

const diagnosticList = requiredElement<HTMLElement>("#diagnostic-list");
const clearDiagnosticsButton = requiredElement<HTMLButtonElement>("#clear-diagnostics");

export async function loadDiagnostics(): Promise<void> {
  const response = await sendMessage<DiagnosticEvent[]>({ type: "GET_DIAGNOSTIC_EVENTS" });
  if (!response.ok) throw new Error(response.error ?? "诊断记录读取失败");
  const events = response.data ?? [];
  if (events.length === 0) {
    diagnosticList.className = "mt-4 rounded-xl bg-stone-50 px-4 py-5 text-center text-sm text-stone-400 dark:bg-[#242426] dark:text-white/40";
    diagnosticList.textContent = "暂无诊断记录";
    return;
  }
  diagnosticList.className = "mt-4 grid gap-3";
  const labels = { proxy: "代理", subscription: "订阅", background: "后台" };
  const fragment = document.createDocumentFragment();
  for (const item of events) {
    const row = document.createElement("article");
    row.className = "grid gap-1 rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#242426]";
    const title = document.createElement("strong");
    title.className = "text-sm";
    title.textContent = `[${labels[item.type]}] ${item.message}`;
    const time = document.createElement("time");
    time.dateTime = item.occurredAt;
    setRelativeTimeStatus(time, item.occurredAt, {
      baseClass: "text-xs font-semibold",
      freshMinutes: 60,
      staleMinutes: 1_440,
    });
    const details = document.createElement("small");
    details.className = "text-sm text-stone-500 dark:text-white/65";
    details.textContent = item.details || "无更多信息";
    row.append(title, time, details);
    fragment.append(row);
  }
  diagnosticList.replaceChildren(fragment);
}

clearDiagnosticsButton.addEventListener("click", () => {
  clearDiagnosticsButton.disabled = true;
  void sendMessage({ type: "CLEAR_DIAGNOSTIC_EVENTS" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "清除失败");
      await loadDiagnostics();
      showToast(response.message ?? "诊断记录已清除", "success");
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "清除失败", "error"))
    .finally(() => { clearDiagnosticsButton.disabled = false; });
});
