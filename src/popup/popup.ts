import "../ui/ui.css";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup 页面缺少必要元素：${selector}`);
  return element;
}

const settingsButton = requiredElement<HTMLButtonElement>("#open-settings");
const proxyToggleButton = requiredElement<HTMLButtonElement>("#proxy-toggle");
const toggleLabel = requiredElement<HTMLElement>("#toggle-label");

interface ProxyStatus {
  desiredEnabled: boolean;
  applied: boolean;
}

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

let enabled = false;

function renderStatus(status: ProxyStatus): void {
  enabled = status.desiredEnabled || status.applied;
  proxyToggleButton.disabled = false;
  proxyToggleButton.setAttribute("aria-checked", String(enabled));
  proxyToggleButton.classList.toggle("active", enabled);
  toggleLabel.textContent = enabled ? "ON" : "OFF";
}

async function refreshStatus(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_PROXY_STATUS" }) as RuntimeResponse<ProxyStatus>;
  if (!response.ok || !response.data) throw new Error(response.error ?? "代理状态读取失败");
  renderStatus(response.data);
}

settingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

proxyToggleButton.addEventListener("click", () => {
  proxyToggleButton.disabled = true;
  void chrome.runtime.sendMessage({ type: enabled ? "DISABLE_PROXY" : "ENABLE_PROXY" })
    .then(async (response: RuntimeResponse) => {
      if (!response.ok) throw new Error(response.error ?? "操作失败");
      await refreshStatus();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      try {
        await refreshStatus();
      } catch (refreshError) {
        console.error(refreshError);
        proxyToggleButton.disabled = false;
      }
    });
});

void refreshStatus().catch((error: unknown) => {
  console.error(error);
  proxyToggleButton.disabled = false;
});
