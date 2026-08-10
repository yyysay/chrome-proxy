import "../ui/ui.css";
import { SAMPLE_CONFIG_YAML, validateConfigDocument } from "../config/config-document.ts";
import type { RuntimeMessage, RuntimeResponse } from "../shared/runtime-protocol.ts";
import { fetchRemoteYaml, requestUrlPermissions } from "../settings/runtime-client.ts";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`引导页面缺少必要元素：${selector}`);
  return element;
}

const remoteForm = required<HTMLFormElement>("#onboarding-remote-form");
const manualForm = required<HTMLFormElement>("#onboarding-manual-form");
const urlInput = required<HTMLInputElement>("#onboarding-config-url");
const input = required<HTMLTextAreaElement>("#onboarding-config");
const hint = required<HTMLElement>("#onboarding-hint");
const remoteSubmit = required<HTMLButtonElement>("#apply-remote-and-enable");
const manualSubmit = required<HTMLButtonElement>("#apply-manual-and-enable");

async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

input.value = SAMPLE_CONFIG_YAML;

async function applyAndEnable(yaml: string, sourceUrl: string, submit: HTMLButtonElement): Promise<void> {
  const validation = validateConfigDocument(yaml);
  if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
  await requestUrlPermissions(Object.values(validation.document.ruleProviders).map((provider) => provider.url));
  submit.disabled = true;
  hint.textContent = "正在下载规则并生成 PAC…";
  const applied = await sendMessage({ type: "APPLY_CONFIG_DOCUMENT", yaml, sourceUrl });
  if (!applied.ok) throw new Error(applied.error ?? "配置应用失败");
  const enabled = await sendMessage({ type: "ENABLE_PROXY" });
  if (!enabled.ok) throw new Error(enabled.error ?? "代理开启失败");
  hint.textContent = "配置已生效，Auto Proxy 已开启。";
  submit.textContent = "已完成";
}

remoteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    remoteSubmit.disabled = true;
    hint.textContent = "正在同步远程 YAML…";
    const remote = await fetchRemoteYaml(urlInput.value);
    input.value = remote.yaml;
    await applyAndEnable(remote.yaml, remote.url, remoteSubmit);
  })().catch((error) => {
    hint.textContent = error instanceof Error ? error.message : "远程配置同步失败";
    remoteSubmit.disabled = false;
  });
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void applyAndEnable(input.value, "", manualSubmit).catch((error) => {
    hint.textContent = error instanceof Error ? error.message : "配置失败";
    manualSubmit.disabled = false;
  });
});

required<HTMLButtonElement>("#open-settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
required<HTMLButtonElement>("#close-page").addEventListener("click", () => window.close());
