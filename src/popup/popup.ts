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
const proxyToggleButton =
  requiredElement<HTMLButtonElement>("#proxy-toggle");
const stateTitleElement =
  requiredElement<HTMLElement>("#state-title");
const statusDotElement =
  requiredElement<HTMLElement>("#status-dot");
const proxyEndpointElement =
  requiredElement<HTMLElement>("#proxy-endpoint");
const fallbackLabelElement =
  requiredElement<HTMLElement>("#fallback-label");
const ruleCountElement =
  requiredElement<HTMLElement>("#rule-count");


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
    ruleEngineStatus?: {
      statistics: {
        parsed: number;
        effective: number;
        duplicates: number;
        conflicts: number;
        issues: number;
      };
      pacBytes: number;
      generatedAt: string;
    };
  };
  error?: string;
}

const proxyStatusElement =
  requiredElement<HTMLElement>("#proxy-status");
let proxyEnabled = false;

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
  proxyStatusElement.textContent = "正在检查代理连接…";

  try {
    const response = await sendRuntimeMessage("CHECK_PROXY_CONNECTIVITY");

    if (!response.ok) {
      throw new Error(response.error ?? "局域网代理检测失败");
    }

    proxyStatusElement.textContent = response.message ?? "代理连接正常";
  } catch (error) {
    proxyStatusElement.textContent =
      `连接失败：${error instanceof Error ? error.message : "请检查代理设置"}`;
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

  const desiredEnabled = response.data?.desiredEnabled === true;
  const applied = response.data?.applied === true;
  const proxyEndpoint = response.data?.proxyEndpoint;
  const fallbackMode = response.data?.fallbackMode ?? "direct";
  const engine = response.data?.ruleEngineStatus;
  const fallbackLabel = {
    direct: "本地直连",
    proxy: "局域网代理",
    system: "系统代理",
  }[fallbackMode];

  proxyEnabled = desiredEnabled || applied;
  proxyToggleButton.disabled = false;
  proxyToggleButton.textContent = proxyEnabled ? "关闭分流" : "开启分流";
  proxyToggleButton.classList.toggle("active", proxyEnabled);
  statusDotElement.classList.toggle("active", applied);
  proxyEndpointElement.textContent = proxyEndpoint ?? "未配置";
  fallbackLabelElement.textContent = fallbackLabel;
  ruleCountElement.textContent = engine
    ? `${engine.statistics.effective} 条`
    : "0 条";

  if (applied) {
    stateTitleElement.textContent = "分流已开启";
    statusElement.textContent = "网站会按照已启用的规则连接";
  } else if (desiredEnabled) {
    stateTitleElement.textContent = "分流暂未生效";
    statusElement.textContent = "请打开设置检查代理配置";
  } else {
    stateTitleElement.textContent = "分流已关闭";
    statusElement.textContent = "Chrome 使用原来的网络设置";
  }
}

proxyToggleButton.addEventListener("click", async () => {
  proxyToggleButton.disabled = true;
  proxyStatusElement.textContent = proxyEnabled ? "正在关闭…" : "正在开启…";

  try {
    const response = await sendRuntimeMessage(
      proxyEnabled ? "DISABLE_PROXY" : "ENABLE_TEST_PROXY",
    );

    if (!response.ok) {
      throw new Error(response.error ?? "操作失败");
    }

    proxyStatusElement.textContent = proxyEnabled ? "分流已关闭" : "分流已开启";
    await refreshProxyStatus();
  } catch (error) {
    proxyStatusElement.textContent =
      error instanceof Error ? error.message : "操作失败";
    proxyToggleButton.disabled = false;
  }
});

void refreshProxyStatus();
