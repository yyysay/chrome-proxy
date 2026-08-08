import { ACTIVE_SETTINGS_TAB_KEY } from "../shared/storage-keys.ts";
import { loadDiagnostics } from "./diagnostics.ts";
import { requiredElement } from "./dom.ts";
import { showToast } from "./toast.ts";

export type SettingsTab = "proxy" | "rules";

const aboutButton = requiredElement<HTMLButtonElement>("#about-button");
const aboutPanel = requiredElement<HTMLElement>('[data-view-panel="about"]');
const versionElement = requiredElement<HTMLElement>("#version");
const installedAtElement = requiredElement<HTMLElement>("#installed-at");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));

function styleTabButton(button: HTMLButtonElement, active: boolean): void {
  button.className = active
    ? "tab inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-extrabold text-emerald-700 ring-1 ring-emerald-100 dark:bg-[#0a84ff]/15 dark:text-[#64d2ff] dark:ring-[#0a84ff]/30"
    : "tab inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:text-white/65 dark:hover:bg-white/8 dark:hover:text-white";
}

export function activateTab(tab: SettingsTab): void {
  aboutPanel.hidden = true;
  aboutButton.className = "about-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:text-white/65 dark:hover:bg-white/8 dark:hover:text-white";
  aboutButton.setAttribute("aria-pressed", "false");
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === tab;
    styleTabButton(button, active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== tab;
}

function openAbout(): void {
  for (const button of tabButtons) {
    styleTabButton(button, false);
    button.setAttribute("aria-selected", "false");
  }
  for (const panel of tabPanels) panel.hidden = true;
  aboutPanel.hidden = false;
  aboutButton.className = "about-button inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-extrabold text-emerald-700 ring-1 ring-emerald-100 dark:bg-[#0a84ff]/15 dark:text-[#64d2ff] dark:ring-[#0a84ff]/30";
  aboutButton.setAttribute("aria-pressed", "true");
}

export function initializeNavigation(tab: SettingsTab, installedAt?: string): void {
  versionElement.textContent = chrome.runtime.getManifest().version;
  installedAtElement.textContent = installedAt
    ? new Date(installedAt).toLocaleString("zh-CN", { hour12: false })
    : "暂无记录";
  activateTab(tab);
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;
    if (target !== "proxy" && target !== "rules") return;
    activateTab(target);
    void chrome.storage.local.set({ [ACTIVE_SETTINGS_TAB_KEY]: target });
  });
}

aboutButton.addEventListener("click", () => {
  openAbout();
  void loadDiagnostics().catch((error) => {
    showToast(error instanceof Error ? error.message : "诊断读取失败", "error");
  });
});
