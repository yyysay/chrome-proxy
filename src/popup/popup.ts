import "./popup.css";


function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Popup 页面缺少必要元素：${selector}`);
  }

  return element;
}

const statusElement =
  requiredElement<HTMLParagraphElement>("#status");
const checkProxyButton =
  requiredElement<HTMLButtonElement>("#check-proxy");


const settingsButton =
  document.querySelector<HTMLButtonElement>("#open-settings");

if (!settingsButton) {
  throw new Error("Popup 页面缺少打开设置按钮");
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

interface RuntimeResponse {
  ok: boolean;
  message?: string;
  data?: {
    levelOfControl?: string;
    mode?: string;
    desiredEnabled?: boolean;
    applied?: boolean;
    proxyEndpoint?: string;
    fallbackMode?: "direct" | "proxy" | "system";
    lastEvent?: {
      type: "enabled" | "disabled" | "restored" | "lost";
      reason: string;
      occurredAt: string;
      observedMode?: string;
      levelOfControl?: string;
    };
    lastProxyError?: {
      error: string;
      details: string;
      fatal: boolean;
      occurredAt: string;
    };
  };
  error?: string;
}

const enableProxyButton =
  requiredElement<HTMLButtonElement>("#enable-test-proxy");

const disableProxyButton =
  requiredElement<HTMLButtonElement>("#disable-proxy");

const proxyStatusElement =
  requiredElement<HTMLElement>("#proxy-status");

async function sendRuntimeMessage(
  type:
    | "ENABLE_TEST_PROXY"
    | "DISABLE_PROXY"
    | "GET_PROXY_STATUS"
    | "CHECK_PROXY_CONNECTIVITY",
): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage({ type }) as Promise<RuntimeResponse>;
}

checkProxyButton.addEventListener("click", async () => {
  checkProxyButton.disabled = true;
  statusElement.textContent = "正在检测局域网 HTTP 代理…";

  try {
    const response = await sendRuntimeMessage("CHECK_PROXY_CONNECTIVITY");

    if (!response.ok) {
      throw new Error(response.error ?? "局域网代理检测失败");
    }

    statusElement.textContent = response.message ?? "局域网代理连接正常";
  } catch (error) {
    statusElement.textContent =
      `局域网代理连接失败：${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    checkProxyButton.disabled = false;
  }
});

async function refreshProxyStatus(): Promise<void> {
  const response = await sendRuntimeMessage("GET_PROXY_STATUS");

  if (!response.ok) {
    proxyStatusElement.textContent =
      response.error ?? "代理状态读取失败";
    return;
  }

  const mode = response.data?.mode ?? "未设置";
  const control = response.data?.levelOfControl ?? "未知";
  const desiredEnabled = response.data?.desiredEnabled === true;
  const applied = response.data?.applied === true;
  const lastEvent = response.data?.lastEvent;
  const proxyEndpoint = response.data?.proxyEndpoint;
  const lastProxyError = response.data?.lastProxyError;
  const fallbackMode = response.data?.fallbackMode ?? "direct";
  const fallbackLabel = {
    direct: "本地直连",
    proxy: "局域网代理",
    system: "系统代理",
  }[fallbackMode];

  enableProxyButton.disabled = applied;
  disableProxyButton.disabled = !desiredEnabled && !applied;

  if (applied && proxyEndpoint) {
    statusElement.textContent =
      `测试分流已启用：${proxyEndpoint}`;
  } else if (desiredEnabled) {
    statusElement.textContent = "分流期望开启，但当前未生效";
  } else {
    statusElement.textContent = "测试分流未启用";
  }

  proxyStatusElement.textContent =
    `分流状态：${applied ? "已开启" : "未开启"}；` +
    `兜底：${fallbackLabel}；当前模式：${mode}；控制状态：${control}` +
    (desiredEnabled && !applied
      ? "；用户期望开启，但 Chrome 配置未生效"
      : "") +
    (lastEvent
      ? `；最近事件：${lastEvent.type}（${new Date(lastEvent.occurredAt).toLocaleTimeString("zh-CN")}）`
      : "") +
    (lastProxyError
      ? `；最近代理错误：${lastProxyError.error}${lastProxyError.fatal ? "（致命）" : ""}`
      : "");
}

enableProxyButton.addEventListener("click", async () => {
  enableProxyButton.disabled = true;
  proxyStatusElement.textContent = "正在写入并验证分流设置…";

  try {
    const response = await sendRuntimeMessage("ENABLE_TEST_PROXY");

    if (!response.ok) {
      throw new Error(response.error ?? "启用失败");
    }

    statusElement.textContent = response.message ?? "分流已开启";
    await refreshProxyStatus();
  } catch (error) {
    proxyStatusElement.textContent =
      error instanceof Error ? error.message : "启用失败";
    enableProxyButton.disabled = false;
  }
});

disableProxyButton.addEventListener("click", async () => {
  disableProxyButton.disabled = true;
  proxyStatusElement.textContent = "正在关闭分流…";

  try {
    const response = await sendRuntimeMessage("DISABLE_PROXY");

    if (!response.ok) {
      throw new Error(response.error ?? "关闭失败");
    }

    statusElement.textContent = response.message ?? "分流已关闭";
    await refreshProxyStatus();
  } catch (error) {
    proxyStatusElement.textContent =
      error instanceof Error ? error.message : "关闭失败";
    disableProxyButton.disabled = false;
  }
});

void refreshProxyStatus();
