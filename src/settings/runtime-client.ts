import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";

export async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

export async function requestUrlPermissions(urls: readonly string[]): Promise<void> {
  const origins = [...new Set(urls.map((url) => new URL(url).origin)
    .filter((origin) => origin !== "https://raw.githubusercontent.com")
    .map((origin) => `${origin}/*`))];
  if (origins.length === 0 || await chrome.permissions.contains({ origins })) return;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error("未授予远程配置地址的访问权限");
}

const MAX_REMOTE_CONFIG_BYTES = 256 * 1024;

export async function fetchRemoteYaml(rawUrl: string): Promise<{ url: string; yaml: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("请输入有效的远程 YAML 地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("远程 YAML 地址仅支持 HTTP/HTTPS");
  }
  await requestUrlPermissions([url.href]);
  const response = await fetch(url.href, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`远程 YAML 下载失败：HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_CONFIG_BYTES) {
    throw new Error("远程 YAML 超过 256 KB 限制");
  }
  const yaml = await response.text();
  if (new TextEncoder().encode(yaml).byteLength > MAX_REMOTE_CONFIG_BYTES) {
    throw new Error("远程 YAML 超过 256 KB 限制");
  }
  return { url: url.href, yaml };
}
