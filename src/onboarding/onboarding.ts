import "./onboarding.css";

interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
  fallbackMode?: "direct" | "proxy" | "system";
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

const enableButton = requiredElement<HTMLButtonElement>("#enable-proxy");
const closeButton = requiredElement<HTMLButtonElement>("#close-page");
const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const statusDot = requiredElement<HTMLElement>("#status-dot");
const statusText = requiredElement<HTMLElement>("#onboarding-status");
const detailText = requiredElement<HTMLElement>("#onboarding-detail");

async function sendMessage<T>(message: object): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

function renderStatus(status: ProxyStatus): void {
  const enabled = status.desiredEnabled || status.applied;
  statusDot.classList.toggle("active", status.applied);
  enableButton.disabled = enabled;
  enableButton.textContent = enabled ? "Auto Proxy 已开启" : "开启 Auto Proxy";
  closeButton.hidden = !enabled;

  if (status.applied) {
    statusText.textContent = "已经可以使用";
    detailText.textContent = status.fallbackMode === "system"
      ? "当前交由系统代理处理。以后可直接关闭本页面。"
      : "已按预设规则自动工作。以后可直接关闭本页面。";
  } else if (status.desiredEnabled) {
    statusText.textContent = "代理尚未生效";
    detailText.textContent = "可以进入高级设置检查代理来源。";
  } else {
    statusText.textContent = "尚未开启";
    detailText.textContent = "点击下方按钮即可开始使用。";
  }
}

async function refreshStatus(): Promise<void> {
  const response = await sendMessage<ProxyStatus>({ type: "GET_PROXY_STATUS" });
  if (!response.ok || !response.data) throw new Error(response.error ?? "状态读取失败");
  renderStatus(response.data);
}

enableButton.addEventListener("click", () => {
  enableButton.disabled = true;
  enableButton.textContent = "正在开启…";
  void sendMessage({ type: "ENABLE_PROXY" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "开启失败");
      await refreshStatus();
    })
    .catch((error: unknown) => {
      enableButton.disabled = false;
      enableButton.textContent = "重新尝试";
      statusText.textContent = "开启失败";
      detailText.textContent = error instanceof Error ? error.message : "请进入高级设置检查代理配置。";
    });
});

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

closeButton.addEventListener("click", () => {
  window.close();
});

void refreshStatus().catch((error: unknown) => {
  enableButton.disabled = false;
  statusText.textContent = "状态读取失败";
  detailText.textContent = error instanceof Error ? error.message : "请重新打开此页面。";
});
