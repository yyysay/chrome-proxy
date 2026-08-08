import type { DiagnosticEvent } from "../shared/runtime-protocol.ts";
import {
  DIAGNOSTIC_EVENTS_KEY,
  LAST_PROXY_ERROR_KEY,
} from "../shared/storage-keys.ts";

const MAX_DIAGNOSTIC_EVENTS = 30;

let diagnosticWrite = Promise.resolve();

export function recordDiagnosticEvent(
  event: Omit<DiagnosticEvent, "occurredAt">,
): Promise<void> {
  diagnosticWrite = diagnosticWrite.then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_EVENTS_KEY);
    const existing = Array.isArray(stored[DIAGNOSTIC_EVENTS_KEY])
      ? stored[DIAGNOSTIC_EVENTS_KEY] as DiagnosticEvent[]
      : [];
    const next: DiagnosticEvent = {
      ...event,
      occurredAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({
      [DIAGNOSTIC_EVENTS_KEY]: [next, ...existing].slice(0, MAX_DIAGNOSTIC_EVENTS),
    });
  }).catch(() => undefined);

  return diagnosticWrite;
}

export async function getDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  const stored = await chrome.storage.local.get(DIAGNOSTIC_EVENTS_KEY);
  return Array.isArray(stored[DIAGNOSTIC_EVENTS_KEY])
    ? stored[DIAGNOSTIC_EVENTS_KEY] as DiagnosticEvent[]
    : [];
}

export async function clearDiagnosticEvents(): Promise<void> {
  await chrome.storage.local.remove([
    DIAGNOSTIC_EVENTS_KEY,
    LAST_PROXY_ERROR_KEY,
  ]);
}

export function recordProxyError(details: {
  error: string;
  details: string;
  fatal: boolean;
}): void {
  // 仅持久化到扩展内诊断中心，避免 chrome://extensions 被运行时网络错误占满。
  void chrome.storage.local.set({
    [LAST_PROXY_ERROR_KEY]: {
      ...details,
      occurredAt: new Date().toISOString(),
    },
  });
  void recordDiagnosticEvent({
    type: "proxy",
    message: details.error,
    details: details.details,
  });
}
