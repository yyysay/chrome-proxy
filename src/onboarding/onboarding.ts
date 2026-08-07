import "../ui/ui.css";
import { DEFAULT_PROXY_SUBSCRIPTION_URL } from "../proxy/proxy-provider";

interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
}

interface ProxyProviderState {
  subscriptionUrl: string;
  subscription?: {
    fetchedAt: string;
    document: { proxies: Array<{ name: string; host: string; port: number }> };
  };
}

interface SaveSubscriptionResult {
  state: ProxyProviderState;
  updateFailed?: string;
  usedCached?: boolean;
}

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: string;
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
const savedSubscriptionPreview = requiredElement<HTMLElement>("#saved-subscription-preview");
const enableButton = requiredElement<HTMLButtonElement>("#enable-proxy");
const enableHint = requiredElement<HTMLElement>("#enable-step-hint");
const closeButton = requiredElement<HTMLButtonElement>("#close-page");
const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const stepButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-step-nav]"));
const stepPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-step-panel]"));

let currentStep = 1;
let maxUnlockedStep = 1;

async function sendMessage<T>(message: object): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

function setStepButtonState(button: HTMLButtonElement, step: number): void {
  const active = step === currentStep;
  const unlocked = step <= maxUnlockedStep;
  button.disabled = !unlocked;
  button.className = [
    "step-nav rounded-2xl border px-4 py-4 text-left transition",
    active
      ? "border-stone-900 bg-stone-900 text-white shadow-lg shadow-stone-900/10"
      : unlocked
        ? "border-stone-200 bg-white text-stone-900 hover:border-stone-300 hover:bg-stone-50"
        : "cursor-not-allowed border-stone-200 bg-stone-50 text-stone-400 opacity-70",
  ].join(" ");

  const index = button.querySelector<HTMLElement>(".step-index");
  if (!index) return;
  index.className = [
    "step-index grid size-8 place-items-center rounded-full text-sm font-black transition",
    active
      ? "bg-white text-stone-900"
      : step < maxUnlockedStep
        ? "bg-emerald-100 text-emerald-700"
        : "bg-stone-200 text-stone-600",
  ].join(" ");
  index.textContent = step < maxUnlockedStep ? "✓" : String(step);

  const small = button.querySelector("small");
  if (small) small.className = `block text-xs ${active ? "text-white/60" : "text-stone-400"}`;
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
  subscriptionHint.className = `text-sm ${error ? "text-red-600" : "text-stone-400"}`;
}

function setEnableHint(message: string, error = false): void {
  enableHint.textContent = message;
  enableHint.className = `text-sm ${error ? "text-red-600" : "text-stone-400"}`;
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

    savedSubscriptionPreview.textContent = response.data.state.subscriptionUrl;
    setSubscriptionHint("订阅已保存并成功加载。");
    unlockStep(2);
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
  setEnableHint("正在应用默认规则…");
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
    savedSubscriptionPreview.textContent = provider.subscriptionUrl;
    maxUnlockedStep = 2;
  }
  if (status?.applied || status?.desiredEnabled) {
    maxUnlockedStep = 3;
    showStep(3);
    return;
  }
  showStep(provider?.subscription ? 2 : 1);
}

void initialize().catch((error: unknown) => {
  subscriptionUrlInput.value ||= DEFAULT_PROXY_SUBSCRIPTION_URL;
  setSubscriptionHint(error instanceof Error ? error.message : "初始化失败，请重新打开页面。", true);
  showStep(1);
});
