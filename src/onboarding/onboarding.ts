import "../ui/ui.css";
import type { ProxyStatus } from "../proxy/proxy-manager";
import {
  DEFAULT_PROXY_SUBSCRIPTION_URL,
  type ProxyProviderState,
} from "../proxy/proxy-provider";
import type { NetworkInfoResult } from "../shared/network-types.ts";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../shared/runtime-protocol.ts";

interface SaveSubscriptionResult {
  state: ProxyProviderState;
  updateFailed?: string;
  usedCached?: boolean;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`引导页面缺少必要元素：${selector}`);
  return element;
}

const subscriptionForm = requiredElement<HTMLFormElement>("#onboarding-subscription-form");
const subscriptionUrlInput = requiredElement<HTMLInputElement>("#onboarding-subscription-url");
const subscriptionHint = requiredElement<HTMLElement>("#subscription-step-hint");
const saveSubscriptionButton = requiredElement<HTMLButtonElement>("#save-subscription");
const enableButton = requiredElement<HTMLButtonElement>("#enable-proxy");
const enableHint = requiredElement<HTMLElement>("#enable-step-hint");
const closeButton = requiredElement<HTMLButtonElement>("#close-page");
const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const healthCard = requiredElement<HTMLElement>("#onboarding-health");
const healthTitle = requiredElement<HTMLElement>("#onboarding-health-title");
const healthSummary = requiredElement<HTMLElement>("#onboarding-health-summary");
const healthDot = requiredElement<HTMLElement>("#onboarding-health-dot");
const healthActions = requiredElement<HTMLElement>("#onboarding-health-actions");
const directIp = requiredElement<HTMLElement>("#onboarding-direct-ip");
const proxyIp = requiredElement<HTMLElement>("#onboarding-proxy-ip");
const backToSubscriptionButton = requiredElement<HTMLButtonElement>("#back-to-subscription");
const showManualProxyButton = requiredElement<HTMLButtonElement>("#show-manual-proxy");
const manualForm = requiredElement<HTMLFormElement>("#onboarding-manual-form");
const manualHost = requiredElement<HTMLInputElement>("#onboarding-manual-host");
const manualPort = requiredElement<HTMLInputElement>("#onboarding-manual-port");
const stepButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-step-nav]"));
const stepPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-step-panel]"));

let currentStep = 1;
let maxUnlockedStep = 1;

async function sendMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

function setStepButtonState(button: HTMLButtonElement, step: number): void {
  const active = step === currentStep;
  const unlocked = step <= maxUnlockedStep;
  button.disabled = !unlocked;
  button.className = [
    "step-nav rounded-xl border px-3 py-3 text-left transition",
    active
      ? "border-stone-900 bg-stone-900 text-white shadow-lg shadow-stone-900/10 dark:border-[#0a84ff] dark:bg-[#0a84ff] dark:shadow-black/20"
      : unlocked
        ? "border-stone-200 bg-white text-stone-900 hover:border-stone-300 hover:bg-stone-50 dark:border-white/10 dark:bg-[#2c2c2e] dark:text-[#f5f5f7] dark:hover:border-white/25 dark:hover:bg-[#323235]"
        : "cursor-not-allowed border-stone-200 bg-stone-50 text-stone-400 opacity-70 dark:border-white/10 dark:bg-[#242426] dark:text-white/35",
  ].join(" ");

  const index = button.querySelector<HTMLElement>(".step-index");
  if (!index) return;
  index.className = [
    "step-index grid size-8 place-items-center rounded-full text-sm font-black transition",
    active
      ? "bg-white text-stone-900 dark:text-[#0a84ff]"
      : step < maxUnlockedStep
        ? "bg-emerald-100 text-emerald-700 dark:bg-[#30d158]/15 dark:text-[#30d158]"
        : "bg-stone-200 text-stone-600 dark:bg-white/10 dark:text-white/65",
  ].join(" ");
  index.textContent = step < maxUnlockedStep ? "✓" : String(step);

  const small = button.querySelector("small");
  if (small) small.className = `block text-xs ${active ? "text-white/60" : "text-stone-400 dark:text-white/40"}`;
}

function showStep(step: number): void {
  if (step > maxUnlockedStep) return;
  currentStep = step;
  for (const panel of stepPanels) {
    panel.hidden = Number(panel.dataset.stepPanel) !== step;
  }
  for (const button of stepButtons) {
    setStepButtonState(button, Number(button.dataset.stepNav));
  }
}

function unlockStep(step: number): void {
  maxUnlockedStep = Math.max(maxUnlockedStep, step);
  showStep(step);
}

async function requestUrlPermission(url: string): Promise<void> {
  const parsed = new URL(url);
  const origins = [`${parsed.origin}/*`];
  if (await chrome.permissions.contains({ origins })) return;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error("需要允许访问该订阅地址才能继续");
}

function setSubscriptionHint(message: string, error = false): void {
  subscriptionHint.textContent = message;
  subscriptionHint.className = `text-sm ${error ? "text-red-600 dark:text-[#ff6961]" : "text-stone-400 dark:text-white/40"}`;
}

function setEnableHint(message: string, error = false): void {
  enableHint.textContent = message;
  enableHint.className = `text-sm ${error ? "text-red-600 dark:text-[#ff6961]" : "text-stone-400 dark:text-white/40"}`;
}

async function runHealthCheck(): Promise<boolean> {
  healthCard.className = "mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-[#ff9f0a]/40 dark:bg-[#ff9f0a]/15";
  healthTitle.className = "block text-sm text-amber-800 dark:text-[#ff9f0a]";
  healthTitle.textContent = "正在检测代理…";
  healthSummary.className = "mt-1 block text-xs text-amber-700 dark:text-[#ffb340]";
  healthSummary.textContent = "请稍候，正在比较直连与代理出口。";
  healthDot.className = "size-2.5 shrink-0 rounded-full bg-amber-500 dark:bg-[#ff9f0a]";
  directIp.textContent = "检测中";
  proxyIp.textContent = "检测中";
  healthActions.hidden = true;
  manualForm.hidden = true;
  enableButton.disabled = true;

  const response = await sendMessage<NetworkInfoResult>({ type: "GET_NETWORK_INFO" });
  const data = response.data;
  const healthy = Boolean(response.ok && data?.direct && data.proxy && !data.sameExitIp);
  directIp.textContent = data?.direct?.ip ?? "获取失败";
  proxyIp.textContent = data?.proxy?.ip ?? "获取失败";

  if (healthy) {
    healthCard.className = "mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-[#30d158]/35 dark:bg-[#30d158]/15";
    healthTitle.className = "block text-sm text-emerald-800 dark:text-[#30d158]";
    healthTitle.textContent = "代理检测通过";
    healthSummary.className = "mt-1 block text-xs text-emerald-700 dark:text-[#66dc7f]";
    healthSummary.textContent = "代理出口与本地直连不同，可以继续开启。";
    healthDot.className = "size-2.5 shrink-0 rounded-full bg-emerald-500 dark:bg-[#30d158]";
    enableButton.disabled = false;
    setEnableHint("检测通过，可以开启。");
    return true;
  }

  healthCard.className = "mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 dark:border-[#ff453a]/40 dark:bg-[#ff453a]/15";
  healthTitle.className = "block text-sm text-red-800 dark:text-[#ff6961]";
  healthTitle.textContent = "代理检测未通过";
  healthSummary.className = "mt-1 block text-xs text-red-700 dark:text-[#ff6961]";
  healthSummary.textContent = data?.proxyError || data?.directError ||
    (data?.sameExitIp ? "代理出口与本地直连相同。" : response.error) || "请检查代理配置。";
  healthDot.className = "size-2.5 shrink-0 rounded-full bg-red-500 dark:bg-[#ff453a]";
  healthActions.hidden = false;
  setEnableHint("请先修正代理配置，再继续开启。", true);
  return false;
}

subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const url = subscriptionUrlInput.value.trim();
    if (!url) throw new Error("请填写代理订阅地址");
    await requestUrlPermission(url);

    saveSubscriptionButton.disabled = true;
    saveSubscriptionButton.textContent = "正在保存…";
    setSubscriptionHint("正在获取代理配置…");

    const response = await sendMessage<SaveSubscriptionResult>({ type: "SAVE_PROXY_SUBSCRIPTION", url });
    if (!response.ok || !response.data) throw new Error(response.error ?? "代理订阅保存失败");
    if (response.data.updateFailed || !response.data.state.subscription) {
      throw new Error(response.data.updateFailed ?? "订阅尚未成功加载，请检查地址后重试");
    }

    const modeResponse = await sendMessage({ type: "SET_PROXY_SOURCE_MODE", mode: "subscription" });
    if (!modeResponse.ok) throw new Error(modeResponse.error ?? "切换到代理订阅失败");

    setSubscriptionHint("订阅已保存并成功加载。");
    unlockStep(2);
    await runHealthCheck();
  })().catch((error: unknown) => {
    setSubscriptionHint(error instanceof Error ? error.message : "代理订阅保存失败", true);
  }).finally(() => {
    saveSubscriptionButton.disabled = false;
    saveSubscriptionButton.textContent = "保存并继续";
  });
});

enableButton.addEventListener("click", () => {
  enableButton.disabled = true;
  enableButton.textContent = "正在开启…";
  setEnableHint("正在应用分流规则…");
  void sendMessage({ type: "ENABLE_PROXY" })
    .then((response) => {
      if (!response.ok) throw new Error(response.error ?? "开启失败");
      setEnableHint("Auto Proxy 已开启。");
      unlockStep(3);
    })
    .catch((error: unknown) => {
      setEnableHint(error instanceof Error ? error.message : "开启失败，请检查高级设置。", true);
      enableButton.disabled = false;
      enableButton.textContent = "重新尝试";
    });
});

for (const button of stepButtons) {
  button.addEventListener("click", () => showStep(Number(button.dataset.stepNav)));
}

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

backToSubscriptionButton.addEventListener("click", () => showStep(1));
showManualProxyButton.addEventListener("click", () => {
  manualForm.hidden = false;
  manualHost.focus();
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const host = manualHost.value.trim();
    const port = Number(manualPort.value);
    if (!host || host.includes("://") || host.includes("/")) throw new Error("请输入正确的 IP 或主机名");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1 到 65535 的整数");
    const response = await sendMessage({ type: "SAVE_MANUAL_PROXY", host, port });
    if (!response.ok) throw new Error(response.error ?? "本地代理保存失败");
    await runHealthCheck();
  })().catch((error: unknown) => {
    healthSummary.textContent = error instanceof Error ? error.message : "本地代理保存失败";
  });
});

closeButton.addEventListener("click", () => {
  window.close();
});

async function initialize(): Promise<void> {
  const [statusResponse, providerResponse] = await Promise.all([
    sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" }),
    sendMessage<ProxyProviderState>({ type: "GET_PROXY_PROVIDER_STATE" }),
  ]);

  const provider = providerResponse.ok ? providerResponse.data : undefined;
  const status = statusResponse.ok ? statusResponse.data : undefined;
  subscriptionUrlInput.value = provider?.subscriptionUrl || DEFAULT_PROXY_SUBSCRIPTION_URL;

  if (provider?.subscription) {
    maxUnlockedStep = 2;
  }
  if (status?.applied || status?.desiredEnabled) {
    maxUnlockedStep = 3;
    showStep(3);
    return;
  }
  showStep(provider?.subscription ? 2 : 1);
  if (provider?.subscription) await runHealthCheck();
}

void initialize().catch((error: unknown) => {
  subscriptionUrlInput.value ||= DEFAULT_PROXY_SUBSCRIPTION_URL;
  setSubscriptionHint(error instanceof Error ? error.message : "初始化失败，请重新打开页面。", true);
  showStep(1);
});
