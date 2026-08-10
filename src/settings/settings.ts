import "../ui/ui.css";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import { ACTIVE_SETTINGS_TAB_KEY, INSTALL_TIME_KEY, NETWORK_INFO_CACHE_KEY } from "../shared/storage-keys.ts";
import { initializeConfigSettings } from "./config-settings.ts";
import { initializeNavigation, type SettingsTab } from "./navigation.ts";
import { initializeNetworkInfo } from "./network-info.ts";
import { sendMessage } from "./runtime-client.ts";
import { showToast } from "./toast.ts";
import "./tools-settings.ts";

async function initializeSettings(): Promise<void> {
  const [stored, configResponse] = await Promise.all([
    chrome.storage.local.get([INSTALL_TIME_KEY, ACTIVE_SETTINGS_TAB_KEY, NETWORK_INFO_CACHE_KEY]),
    sendMessage<ConfigDocumentState>({ type: "GET_CONFIG_DOCUMENT_STATE" }),
  ]);
  if (!configResponse.ok || !configResponse.data) throw new Error(configResponse.error ?? "配置读取失败");
  const activeTab: SettingsTab = stored[ACTIVE_SETTINGS_TAB_KEY] === "tools" ? "tools" : "config";
  initializeNavigation(activeTab, typeof stored[INSTALL_TIME_KEY] === "string" ? stored[INSTALL_TIME_KEY] : undefined);
  initializeNetworkInfo(stored[NETWORK_INFO_CACHE_KEY], configResponse.data);
  initializeConfigSettings(configResponse.data);
}

void initializeSettings().catch((error) => {
  console.error(error);
  showToast(error instanceof Error ? error.message : "读取配置失败", "error");
});
