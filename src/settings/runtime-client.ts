import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";

export async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

export async function requestUrlPermission(url: string): Promise<void> {
  if (!url.trim()) return;
  const parsed = new URL(url);
  if (parsed.hostname === "raw.githubusercontent.com") return;
  const origins = [`${parsed.origin}/*`];
  if (await chrome.permissions.contains({ origins })) return;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error("未授予该订阅地址的访问权限");
}
