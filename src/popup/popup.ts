import "../ui/ui.css";
import { validateConfigDocument } from "../config/config-document.ts";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import type { ProxyStatus } from "../proxy/pac-controller.ts";
import { fetchRemoteYaml, requestUrlPermissions, sendMessage } from "../settings/runtime-client.ts";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup 页面缺少必要元素：${selector}`);
  return element;
}

const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const proxyToggleButton = requiredElement<HTMLButtonElement>("#proxy-toggle");
const toggleLabel = requiredElement<HTMLElement>("#toggle-label");
const popupIcon = requiredElement<HTMLImageElement>("#popup-icon");
const siteHost = requiredElement<HTMLElement>("#site-host");
const siteStatus = requiredElement<HTMLElement>("#site-status");
const subscriptionForm = requiredElement<HTMLFormElement>("#popup-subscription-form");
const subscriptionInput = requiredElement<HTMLInputElement>("#popup-subscription-url");
const subscriptionSubmit = requiredElement<HTMLButtonElement>("#popup-subscription-submit");
const subscriptionCancel = requiredElement<HTMLButtonElement>("#popup-subscription-cancel");
const subscriptionEdit = requiredElement<HTMLButtonElement>("#popup-subscription-edit");
const subscriptionSummary = requiredElement<HTMLElement>("#popup-subscription-summary");
const subscriptionHint = requiredElement<HTMLElement>("#popup-subscription-hint");

let enabled = false;
let currentUrl = "";
let subscriptionIntervalSeconds = 86_400;
let subscriptionSourceUrl = "";

function setSubscriptionEditor(open: boolean): void {
  subscriptionForm.hidden = !open;
  subscriptionEdit.hidden = open;
  if (open) {
    subscriptionInput.focus();
    subscriptionInput.select();
  }
}

function renderSubscription(sourceUrl: string): void {
  subscriptionSourceUrl = sourceUrl;
  subscriptionInput.value = sourceUrl;
  subscriptionSummary.textContent = sourceUrl ? "已配置" : "尚未设置";
  subscriptionSummary.removeAttribute("title");
  subscriptionEdit.textContent = sourceUrl ? "编辑" : "添加";
}

function renderEngine(status: ProxyStatus): void {
  enabled = status.configured && (status.desiredEnabled || status.applied);
  proxyToggleButton.disabled = !status.configured;
  proxyToggleButton.setAttribute("aria-checked", String(enabled));
  proxyToggleButton.classList.toggle("active", enabled);
  toggleLabel.textContent = enabled ? "ON" : "OFF";
  proxyToggleButton.title = status.configured ? "" : "请先添加并应用 YAML 配置";
}

async function refreshSite(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab?.url ?? "";
  if (!/^https?:/i.test(currentUrl)) {
    siteHost.textContent = tab?.title || "浏览器内部页面";
    siteStatus.textContent = "不可用";
    siteStatus.dataset.statusTone = "idle";
    popupIcon.src = "/icons/icon-48.png";
    return;
  }
  const response = await sendMessage<{
    hostname: string;
    action: string;
    proxied: boolean;
    engineEnabled: boolean;
  }>({ type: "GET_SITE_PROXY_STATUS", input: currentUrl });
  if (!response.ok || !response.data) {
    siteHost.textContent = new URL(currentUrl).hostname;
    siteStatus.textContent = response.error?.includes("请先") ? "未配置" : "未知";
    siteStatus.dataset.statusTone = "idle";
    popupIcon.src = "/icons/icon-48.png";
    return;
  }
  siteHost.textContent = response.data.hostname;
  siteStatus.textContent = response.data.engineEnabled ? response.data.action : "已关闭";
  siteStatus.dataset.statusTone = response.data.proxied ? "fresh" : "idle";
  popupIcon.src = response.data.proxied ? "/icons/icon-active-48.png" : "/icons/icon-48.png";
}

async function refreshState(): Promise<void> {
  const [statusResponse, configResponse] = await Promise.all([
    sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" }),
    sendMessage<ConfigDocumentState>({ type: "GET_CONFIG_DOCUMENT_STATE" }),
  ]);
  if (!statusResponse.ok || !statusResponse.data) throw new Error(statusResponse.error ?? "代理状态读取失败");
  renderEngine(statusResponse.data);
  if (configResponse.ok && configResponse.data) {
    renderSubscription(configResponse.data.sourceUrl);
    subscriptionIntervalSeconds = configResponse.data.remote.intervalSeconds;
  }
  await refreshSite();
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

proxyToggleButton.addEventListener("click", () => {
  proxyToggleButton.disabled = true;
  void sendMessage({ type: enabled ? "DISABLE_PROXY" : "ENABLE_PROXY" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "操作失败");
      await refreshState();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await refreshState().catch(() => { proxyToggleButton.disabled = false; });
    });
});

subscriptionEdit.addEventListener("click", () => setSubscriptionEditor(true));
subscriptionCancel.addEventListener("click", () => {
  subscriptionInput.value = subscriptionSourceUrl;
  subscriptionHint.hidden = true;
  setSubscriptionEditor(false);
});

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    subscriptionSubmit.disabled = true;
    subscriptionHint.textContent = "正在下载并校验订阅…";
    subscriptionHint.hidden = false;
    const remote = await fetchRemoteYaml(subscriptionInput.value);
    const validation = validateConfigDocument(remote.yaml);
    if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
    const activeProviders = new Set(validation.document.rules.flatMap((rule) => {
      const parts = rule.split(",").map((part) => part.trim());
      return parts[0]?.toUpperCase() === "RULE-SET" && parts[1] ? [parts[1]] : [];
    }));
    await requestUrlPermissions(Object.values(validation.document.ruleProviders)
      .filter((provider) => activeProviders.has(provider.name))
      .map((provider) => provider.url));
    const response = await sendMessage({
      type: "APPLY_CONFIG_DOCUMENT",
      yaml: remote.yaml,
      sourceUrl: remote.url,
      refreshIntervalSeconds: subscriptionIntervalSeconds,
    });
    if (!response.ok) throw new Error(response.error ?? "订阅更新失败");
    subscriptionHint.textContent = "订阅已更新并应用。";
    await refreshState();
    setSubscriptionEditor(false);
  })().catch((error) => {
    subscriptionHint.textContent = error instanceof Error ? error.message : "订阅更新失败";
    subscriptionHint.hidden = false;
  }).finally(() => { subscriptionSubmit.disabled = false; });
});

void refreshState().catch((error: unknown) => {
  console.error(error);
  proxyToggleButton.disabled = true;
  siteHost.textContent = "状态读取失败";
  siteStatus.textContent = "错误";
  siteStatus.dataset.statusTone = "error";
});
