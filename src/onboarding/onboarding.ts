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
const progress = required<HTMLElement>("#onboarding-progress");
const progressTitle = required<HTMLElement>("#onboarding-progress-title");
const setup = required<HTMLElement>("#onboarding-setup");
const success = required<HTMLElement>("#onboarding-success");
const remoteSubmit = required<HTMLButtonElement>("#apply-remote-and-enable");
const manualSubmit = required<HTMLButtonElement>("#apply-manual-and-enable");

async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

input.value = SAMPLE_CONFIG_YAML;

async function applyAndEnable(yaml: string, sourceUrl: string, submit: HTMLButtonElement): Promise<void> {
  progress.hidden = false;
  progressTitle.textContent = "正在检测配置";
  hint.textContent = "正在校验节点与规则结构…";
  const validation = validateConfigDocument(yaml);
  if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
  progressTitle.textContent = "配置检测通过";
  hint.textContent = "正在同步远程规则包…";
  await requestUrlPermissions(Object.values(validation.document.ruleProviders).map((provider) => provider.url));
  submit.disabled = true;
  const applied = await sendMessage({ type: "APPLY_CONFIG_DOCUMENT", yaml, sourceUrl });
  if (!applied.ok) throw new Error(applied.error ?? "配置应用失败");
  hint.textContent = "规则已就绪，正在开启代理…";
  const enabled = await sendMessage({ type: "ENABLE_PROXY" });
  if (!enabled.ok) throw new Error(enabled.error ?? "代理开启失败");
  setup.hidden = true;
  success.hidden = false;
}

remoteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    remoteSubmit.disabled = true;
    progress.hidden = false;
    progressTitle.textContent = "正在读取订阅";
    hint.textContent = "正在下载远程 YAML…";
    const remote = await fetchRemoteYaml(urlInput.value);
    input.value = remote.yaml;
    await applyAndEnable(remote.yaml, remote.url, remoteSubmit);
  })().catch((error) => {
    progress.hidden = false;
    progressTitle.textContent = "配置未通过";
    hint.textContent = error instanceof Error ? error.message : "远程配置同步失败";
    remoteSubmit.disabled = false;
  });
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void applyAndEnable(input.value, "", manualSubmit).catch((error) => {
    progress.hidden = false;
    progressTitle.textContent = "配置未通过";
    hint.textContent = error instanceof Error ? error.message : "配置失败";
    manualSubmit.disabled = false;
  });
});

required<HTMLButtonElement>("#open-settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
async function closePage(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
}
required<HTMLButtonElement>("#skip-page").addEventListener("click", () => void closePage());
required<HTMLButtonElement>("#close-page").addEventListener("click", () => void closePage());
