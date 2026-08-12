import { ACTIVE_SETTINGS_TAB_KEY } from "../shared/storage-keys.ts";
import { loadDiagnostics } from "./diagnostics.ts";
import { requiredElement } from "./dom.ts";
import { showToast } from "./toast.ts";

export type SettingsTab = "config" | "tools";

const aboutButton = requiredElement<HTMLButtonElement>("#about-button");
const aboutPanel = requiredElement<HTMLElement>('[data-view-panel="about"]');
const tabIndicator = requiredElement<HTMLElement>(".liquid-tab-indicator");
const versionElement = requiredElement<HTMLElement>("#version");
const installedAtElement = requiredElement<HTMLElement>("#installed-at");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));
let indicatorReady = false;

function moveTabIndicator(button: HTMLButtonElement): void {
  tabIndicator.style.left = `${button.offsetLeft}px`;
  tabIndicator.style.width = `${button.offsetWidth}px`;
  if (!indicatorReady) {
    indicatorReady = true;
    return;
  }
  tabIndicator.classList.remove("is-moving");
  void tabIndicator.offsetWidth;
  tabIndicator.classList.add("is-moving");
}

function styleTabButton(button: HTMLButtonElement, active: boolean): void {
  button.className = active
    ? "tab liquid-tab liquid-tab-active"
    : "tab liquid-tab";
  if (active) requestAnimationFrame(() => moveTabIndicator(button));
}

function styleAboutButton(active: boolean): void {
  aboutButton.className = active
    ? "about-button liquid-tab liquid-tab-active"
    : "about-button liquid-tab";
  if (active) requestAnimationFrame(() => moveTabIndicator(aboutButton));
  aboutButton.setAttribute("aria-selected", String(active));
}

export function activateTab(tab: SettingsTab): void {
  aboutPanel.hidden = true;
  styleAboutButton(false);
  aboutButton.setAttribute("aria-pressed", "false");
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === tab;
    styleTabButton(button, active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== tab;
  document.dispatchEvent(new CustomEvent("settings-tab-activated", { detail: { tab } }));
}

function openAbout(): void {
  for (const button of tabButtons) {
    styleTabButton(button, false);
    button.setAttribute("aria-selected", "false");
  }
  for (const panel of tabPanels) panel.hidden = true;
  aboutPanel.hidden = false;
  styleAboutButton(true);
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
    if (target !== "config" && target !== "tools") return;
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

window.addEventListener("resize", () => {
  const active = document.querySelector<HTMLButtonElement>('.liquid-tab[aria-selected="true"]');
  if (!active) return;
  indicatorReady = false;
  moveTabIndicator(active);
});
