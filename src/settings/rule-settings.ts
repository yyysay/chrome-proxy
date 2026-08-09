import { refreshStatusThresholds, type RefreshUnit } from "../shared/refresh-interval.ts";
import type {
  FallbackMode,
  RuleSourceStrategy,
} from "../shared/runtime-protocol.ts";
import { requiredElement } from "./dom.ts";
import {
  renderRefreshInterval,
  selectedRefreshInterval,
  setCustomIntervalInputLimit,
  setRefreshControlsDisabled,
} from "./refresh-controls.ts";
import {
  clearRelativeTimeStatus,
  formatDateTime,
  relativeTimeLabel,
  setRelativeTimeStatus,
} from "./relative-time.ts";
import { requestUrlPermission, sendMessage } from "./runtime-client.ts";
import { showToast } from "./toast.ts";
import { setStatusBadge } from "./status-badge.ts";
import type { RulePackSetting } from "./types.ts";

const managedRuleCount = requiredElement<HTMLElement>("#managed-rule-count");
const rulePackList = requiredElement<HTMLElement>("#rule-pack-list");
const rulePackEmpty = requiredElement<HTMLElement>("#rule-pack-empty");
const rulePackToggle = requiredElement<HTMLButtonElement>("#rule-pack-toggle");
const fallbackModeElement = requiredElement<HTMLSelectElement>("#fallback-mode");
const addRulePackButton = requiredElement<HTMLButtonElement>("#add-rule-pack");
const refreshEnabledRulesButton = requiredElement<HTMLButtonElement>("#refresh-enabled-rules");
const ruleMatchForm = requiredElement<HTMLFormElement>("#rule-match-form");
const ruleMatchInput = requiredElement<HTMLInputElement>("#rule-match-input");
const autoRefreshEnabled = requiredElement<HTMLInputElement>("#auto-refresh-enabled");
const autoRefreshInterval = requiredElement<HTMLSelectElement>("#auto-refresh-interval");
const autoRefreshCustomGroup = requiredElement<HTMLElement>("#auto-refresh-custom-group");
const autoRefreshCustomValue = requiredElement<HTMLInputElement>("#auto-refresh-custom-value");
const autoRefreshCustomUnit = requiredElement<HTMLSelectElement>("#auto-refresh-custom-unit");
const ruleEditorDialog = requiredElement<HTMLDialogElement>("#rule-editor-dialog");
const ruleEditorForm = requiredElement<HTMLFormElement>("#rule-editor-form");
const ruleEditorTitle = requiredElement<HTMLElement>("#rule-editor-title");
const ruleEditorKicker = requiredElement<HTMLElement>("#rule-editor-kicker");
const ruleEditorHint = requiredElement<HTMLElement>("#rule-editor-hint");
const ruleEditorCloseButton = requiredElement<HTMLButtonElement>("#rule-editor-close");
const ruleEditorCancelButton = requiredElement<HTMLButtonElement>("#rule-editor-cancel");
const ruleEditorDeleteButton = requiredElement<HTMLButtonElement>("#rule-editor-delete");
const ruleEditorRefreshButton = requiredElement<HTMLButtonElement>("#rule-editor-refresh");
const ruleEditorNameInput = requiredElement<HTMLInputElement>("#rule-editor-name");
const ruleEditorUrlInput = requiredElement<HTMLInputElement>("#rule-editor-url");
const ruleEditorActionSelect = requiredElement<HTMLSelectElement>("#rule-editor-action");
const ruleEditorSourceStrategySelect = requiredElement<HTMLSelectElement>("#rule-editor-source-strategy");
const ruleEditorSourceStrategyHint = requiredElement<HTMLElement>("#rule-editor-source-strategy-hint");
const ruleEditorFilePickerButton = requiredElement<HTMLButtonElement>("#rule-editor-file-picker");
const ruleEditorFileInput = requiredElement<HTMLInputElement>("#rule-editor-file-input");
const ruleEditorContent = requiredElement<HTMLTextAreaElement>("#rule-editor-content");
const ruleEditorMeta = requiredElement<HTMLElement>("#rule-editor-meta");
const ruleEditorViewRemoteButton = requiredElement<HTMLButtonElement>("#rule-editor-view-remote");
const remoteRuleContentDialog = requiredElement<HTMLDialogElement>("#remote-rule-content-dialog");
const remoteRuleContentTitle = requiredElement<HTMLElement>("#remote-rule-content-title");
const remoteRuleContentMeta = requiredElement<HTMLElement>("#remote-rule-content-meta");
const remoteRuleContent = requiredElement<HTMLElement>("#remote-rule-content");
const remoteRuleContentCloseButton = requiredElement<HTMLButtonElement>("#remote-rule-content-close");

let rulePackSettings: RulePackSetting[] = [];
let editingRulePack: RulePackSetting | null = null;
let ruleListExpanded = false;
let ruleAutoRefreshEnabled = true;
let ruleAutoRefreshIntervalMinutes = 1_440;

const COLLAPSED_RULE_LIMIT = 4;
const MAX_LOCAL_RULE_FILE_BYTES = 2 * 1024 * 1024;

function latestRuleUpdate(pack: RulePackSetting): string | undefined {
  const candidates = (pack.category === "default"
    ? [pack.source.updatedAt]
    : [pack.source.updatedAt, pack.source.modifiedAt])
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (candidates.length === 0) return undefined;
  return new Date(Math.max(...candidates.map((date) => date.getTime()))).toISOString();
}

function formatRuleUpdate(pack: RulePackSetting): string {
  const latest = latestRuleUpdate(pack);
  if (latest) return `更新于 ${relativeTimeLabel(latest)}`;
  if (pack.category === "builtin") return "随扩展发布";
  if (pack.source.error) return "更新失败";
  return pack.defaultUrl ? "等待首次更新" : "尚未更新";
}

function renderDefaultUpdateStatus(settings: readonly RulePackSetting[]): void {
  const managed = settings.filter((pack) => pack.category === "default");
  const updatedAt = managed
    .map(latestRuleUpdate)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString();

  clearRelativeTimeStatus(managedRuleCount);
  if (updatedAt) {
    const thresholds = refreshStatusThresholds(
      ruleAutoRefreshEnabled,
      ruleAutoRefreshIntervalMinutes,
      1_440,
      10_080,
    );
    setRelativeTimeStatus(managedRuleCount, updatedAt, {
      prefix: "更新于 ",
      baseClass: "status-badge",
      ...thresholds,
      hideWhenFresh: ruleAutoRefreshEnabled,
    });
  } else {
    const updateFailed = managed.some((pack) => Boolean(pack.source.error));
    setStatusBadge(managedRuleCount, updateFailed ? "更新失败" : "尚未更新", updateFailed ? "error" : "idle");
  }

}

function getEnabledRulePackIds(): string[] {
  return Array.from(rulePackList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
    .map((input) => input.value);
}

async function saveRuleSelection(): Promise<void> {
  const response = await sendMessage({ type: "UPDATE_RULE_PACKS", enabledPackIds: getEnabledRulePackIds() });
  if (!response.ok) throw new Error(response.error ?? "规则启用状态保存失败");
  showToast(response.message ?? "规则启用状态已保存", "success");
}

function renderRulePackList(settings: readonly RulePackSetting[]): void {
  const visible = settings.filter((pack) => pack.category !== "builtin");
  rulePackEmpty.hidden = visible.length > 0;
  const fragment = document.createDocumentFragment();
  for (const [index, pack] of visible.entries()) {
    const isDefault = pack.category === "default";
    const card = document.createElement("article");
    card.className = "rounded-xl border border-stone-200 bg-white px-3.5 py-3 transition hover:border-stone-300 hover:shadow-sm dark:border-white/10 dark:bg-[#242426] dark:hover:border-white/25";
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-3";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "min-w-0 flex-1 text-left";
    open.addEventListener("click", () => openRuleEditor(pack));
    const titleLine = document.createElement("span");
    titleLine.className = "flex min-w-0 items-center gap-2";
    const name = document.createElement("strong");
    name.className = "truncate text-[13px] font-extrabold";
    name.textContent = pack.name;
    titleLine.append(name);
    if (isDefault) {
      const defaultBadge = document.createElement("span");
      defaultBadge.className = "shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-extrabold text-stone-500 dark:bg-white/8 dark:text-white/55";
      defaultBadge.textContent = "默认";
      titleLine.append(defaultBadge);
    }
    if (pack.customized) {
      const customizedBadge = document.createElement("span");
      customizedBadge.className = "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 dark:bg-[#ff9f0a]/15 dark:text-[#ff9f0a]";
      customizedBadge.textContent = "已修改";
      titleLine.append(customizedBadge);
    }
    if (pack.source.error) {
      const updateFailedBadge = document.createElement("span");
      updateFailedBadge.className = "shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-700 dark:bg-[#ff453a]/15 dark:text-[#ff6961]";
      updateFailedBadge.textContent = "更新失败";
      updateFailedBadge.title = pack.source.error;
      titleLine.append(updateFailedBadge);
    }
    const meta = document.createElement("span");
    meta.className = "mt-1 block text-[11px] font-semibold text-stone-400 dark:text-white/40";
    meta.textContent = `${pack.validation?.effective ?? 0} 条 · ${pack.defaultAction === "PROXY" ? "代理" : "直连"}`;
    open.append(titleLine, meta);

    const toggle = document.createElement("label");
    toggle.className = "relative inline-flex shrink-0 cursor-pointer items-center";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "peer sr-only";
    checkbox.value = pack.id;
    checkbox.checked = pack.enabled;
    checkbox.setAttribute("aria-label", `启用 ${pack.name}`);
    checkbox.addEventListener("change", () => {
      void saveRuleSelection().catch((error) => {
        checkbox.checked = !checkbox.checked;
        showToast(error instanceof Error ? error.message : "规则保存失败", "error");
      });
    });
    const track = document.createElement("span");
    track.className = "h-6 w-10 rounded-full bg-stone-200 transition peer-checked:bg-emerald-500 after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4 dark:bg-white/15 dark:peer-checked:bg-[#30d158]";
    toggle.append(checkbox, track);
    row.append(open, toggle);
    card.append(row);
    card.hidden = !ruleListExpanded && index >= COLLAPSED_RULE_LIMIT;
    fragment.append(card);
  }
  rulePackList.replaceChildren(fragment);
  const hiddenCount = Math.max(0, visible.length - COLLAPSED_RULE_LIMIT);
  rulePackToggle.hidden = hiddenCount === 0;
  rulePackToggle.setAttribute("aria-expanded", String(ruleListExpanded));
  rulePackToggle.textContent = ruleListExpanded ? "收起规则" : `显示另外 ${hiddenCount} 条`;
}

export function renderRulePacks(settings: RulePackSetting[]): void {
  rulePackSettings = settings;
  renderDefaultUpdateStatus(settings);
  renderRulePackList(settings);
}

function ruleEditorMetaDetails(pack: RulePackSetting): string {
  const status = pack.source.status === "cached" ? "使用缓存" : pack.source.status === "error" ? "更新异常" : "";
  return [pack.validation ? `${pack.validation.effective} 条有效` : undefined, status, pack.source.error]
    .filter(Boolean).join(" · ");
}

function renderRuleEditorMeta(pack?: RulePackSetting): void {
  const updatedAt = pack ? latestRuleUpdate(pack) : undefined;
  ruleEditorMeta.hidden = !pack;
  if (!pack) {
    clearRelativeTimeStatus(ruleEditorMeta);
    return;
  }
  if (pack && updatedAt) {
    const details = ruleEditorMetaDetails(pack);
    const thresholds = refreshStatusThresholds(
      ruleAutoRefreshEnabled,
      ruleAutoRefreshIntervalMinutes,
      1_440,
      10_080,
    );
    setRelativeTimeStatus(ruleEditorMeta, updatedAt, {
      prefix: "更新于 ",
      suffix: details ? ` · ${details}` : "",
      baseClass: "status-badge mt-2",
      ...thresholds,
      hideWhenFresh: ruleAutoRefreshEnabled,
    });
    return;
  }
  clearRelativeTimeStatus(ruleEditorMeta);
  const label = [formatRuleUpdate(pack), ruleEditorMetaDetails(pack)].filter(Boolean).join(" · ");
  setStatusBadge(ruleEditorMeta, label, pack.source.error ? "error" : "idle", pack.source.error);
  ruleEditorMeta.classList.add("mt-2");
}

function renderSourceStrategyHint(): void {
  const strategy = ruleEditorSourceStrategySelect.value as RuleSourceStrategy;
  ruleEditorSourceStrategyHint.textContent = strategy === "local-first"
    ? "只读取本地规则；本地规则为空时得到 0 条规则，不读取远程内容。"
    : strategy === "subscription-first"
      ? "只读取远程下载内容；远程内容为空时得到 0 条规则，不读取本地规则。"
      : "合并远程内容与本地规则，去重后使用；任一来源都可以为空。";
}

function renderRemoteContentAvailability(pack?: RulePackSetting): void {
  ruleEditorViewRemoteButton.hidden = !pack?.source.cachedContent?.trim();
}

function openRemoteRuleContent(): void {
  const content = editingRulePack?.source.cachedContent?.trim();
  if (!editingRulePack || !content) {
    showToast("当前没有可查看的远程下载内容", "warning");
    return;
  }
  remoteRuleContentTitle.textContent = `${editingRulePack.name} · 远程内容`;
  remoteRuleContentMeta.textContent = `${content.split(/\r?\n/).length} 行 · 下载于 ${formatDateTime(editingRulePack.source.updatedAt)}`;
  remoteRuleContent.textContent = content;
  remoteRuleContentDialog.showModal();
}

async function readLocalRuleFile(): Promise<void> {
  const file = ruleEditorFileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_LOCAL_RULE_FILE_BYTES) {
      throw new Error("本地规则文件不能超过 2 MB");
    }
    ruleEditorContent.value = await file.text();
    showToast(`已读取 ${file.name}`, "success");
  } finally {
    ruleEditorFileInput.value = "";
  }
}

function openRuleEditor(pack?: RulePackSetting): void {
  editingRulePack = pack ?? null;
  const managed = pack?.category === "default";
  ruleEditorKicker.textContent = "规则";
  ruleEditorTitle.textContent = pack
    ? `编辑 ${pack.name}`
    : "添加规则";
  ruleEditorNameInput.value = pack?.name ?? "";
  ruleEditorUrlInput.value = pack?.source.url || pack?.defaultUrl || "";
  ruleEditorActionSelect.value = pack?.defaultAction ?? "PROXY";
  ruleEditorSourceStrategySelect.value = pack?.sourceStrategy ?? "subscription-first";
  ruleEditorContent.value = pack?.source.customContent ?? "";
  renderSourceStrategyHint();
  renderRemoteContentAvailability(pack);
  ruleEditorHint.textContent = managed
    ? "这是产品预设的远程规则订阅。可以修改订阅与本地补充内容，也可以恢复预设。"
    : "自定义规则最先匹配，可覆盖默认规则和内置规则的行为。";
  ruleEditorDeleteButton.hidden = !pack || (managed && !pack.customized);
  ruleEditorDeleteButton.textContent = managed ? "恢复默认" : "删除规则";
  ruleEditorDeleteButton.className = managed
    ? "rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-extrabold text-stone-600 transition hover:border-stone-300 hover:text-stone-900 dark:border-white/15 dark:bg-[#2c2c2e] dark:text-white/70 dark:hover:border-white/30 dark:hover:text-white"
    : "rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-extrabold text-red-700 dark:border-[#ff453a]/40 dark:bg-[#ff453a]/15 dark:text-[#ff453a]";
  ruleEditorRefreshButton.hidden = !pack || !(pack.source.url || pack.defaultUrl);
  renderRuleEditorMeta(pack);
  ruleEditorDialog.showModal();
}

function closeRuleEditor(): void {
  editingRulePack = null;
  ruleEditorDialog.close();
}

async function reloadRuleSettings(): Promise<void> {
  const response = await sendMessage<RulePackSetting[]>({ type: "GET_RULE_PACK_SETTINGS" });
  if (!response.ok || !response.data) throw new Error(response.error ?? "规则读取失败");
  renderRulePacks(response.data);
}

async function saveRuleEditor(): Promise<void> {
  const url = ruleEditorUrlInput.value.trim();
  if (url) await requestUrlPermission(url);
  const response = await sendMessage<{ packId: string }>({
    type: "SAVE_RULE_PACK",
    packId: editingRulePack?.id,
    name: ruleEditorNameInput.value.trim(),
    url,
    action: ruleEditorActionSelect.value as "DIRECT" | "PROXY",
    customContent: ruleEditorContent.value,
    sourceStrategy: ruleEditorSourceStrategySelect.value as RuleSourceStrategy,
  });
  if (!response.ok) throw new Error(response.error ?? "规则保存失败");
  closeRuleEditor();
  await reloadRuleSettings();
  showToast(response.message ?? "规则已保存", "success");
}

async function refreshEditingRule(): Promise<void> {
  if (!editingRulePack) return;
  const url = ruleEditorUrlInput.value.trim() || editingRulePack.defaultUrl;
  if (url) await requestUrlPermission(url);
  ruleEditorRefreshButton.disabled = true;
  try {
    const response = await sendMessage({ type: "REFRESH_RULE_PACK", packId: editingRulePack.id });
    if (!response.ok) throw new Error(response.error ?? "规则下载失败");
    await reloadRuleSettings();
    editingRulePack = rulePackSettings.find((pack) => pack.id === editingRulePack?.id) ?? editingRulePack;
    renderRuleEditorMeta(editingRulePack);
    renderRemoteContentAvailability(editingRulePack);
    showToast(response.message ?? "规则已更新", "success");
  } finally {
    ruleEditorRefreshButton.disabled = false;
  }
}

async function deleteEditingRule(): Promise<void> {
  if (!editingRulePack) return;
  ruleEditorDeleteButton.disabled = true;
  try {
    if (editingRulePack.category === "default") {
      const response = await sendMessage({ type: "RESET_MANAGED_RULE_PACK", packId: editingRulePack.id });
      if (!response.ok) throw new Error(response.error ?? "恢复默认失败");
      closeRuleEditor();
      await reloadRuleSettings();
      showToast(response.message ?? "默认规则已恢复为预设订阅", "success");
      return;
    }
    const response = await sendMessage({ type: "DELETE_RULE_PACK", packId: editingRulePack.id });
    if (!response.ok) throw new Error(response.error ?? "删除失败");
    closeRuleEditor();
    await reloadRuleSettings();
    showToast(response.message ?? "规则已删除", "success");
  } finally {
    ruleEditorDeleteButton.disabled = false;
  }
}

function renderFallbackMode(mode: FallbackMode): void {
  fallbackModeElement.value = mode;
}

async function saveFallbackMode(): Promise<void> {
  const fallbackMode = fallbackModeElement.value as FallbackMode;
  const response = await sendMessage({ type: "UPDATE_FALLBACK_MODE", fallbackMode });
  if (!response.ok) throw new Error(response.error ?? "MATCH 策略保存失败");
  showToast(response.message ?? "MATCH 策略已保存", fallbackMode === "system" ? "warning" : "success");
}

async function saveAutoRefreshSettings(): Promise<void> {
  const enabled = autoRefreshEnabled.checked;
  const intervalMinutes = selectedRefreshInterval(
    autoRefreshInterval,
    autoRefreshCustomValue,
    autoRefreshCustomUnit,
  );
  setRefreshControlsDisabled(!enabled, autoRefreshInterval, autoRefreshCustomValue, autoRefreshCustomUnit);
  const response = await sendMessage({ type: "UPDATE_RULE_AUTO_REFRESH", enabled, intervalMinutes });
  if (!response.ok) throw new Error(response.error ?? "自动更新设置保存失败");
  ruleAutoRefreshEnabled = enabled;
  ruleAutoRefreshIntervalMinutes = intervalMinutes;
  renderRulePacks(rulePackSettings);
  if (editingRulePack) renderRuleEditorMeta(editingRulePack);
  showToast(response.message ?? "自动更新设置已保存", "success");
}

export function initializeRuleSettings(
  settings: RulePackSetting[],
  fallbackMode: FallbackMode,
  autoRefresh: { enabled: boolean; intervalMinutes: number },
): void {
  ruleAutoRefreshEnabled = autoRefresh.enabled;
  ruleAutoRefreshIntervalMinutes = autoRefresh.intervalMinutes;
  renderRulePacks(settings);
  renderFallbackMode(fallbackMode);
  autoRefreshEnabled.checked = autoRefresh.enabled;
  renderRefreshInterval(
    autoRefreshInterval,
    autoRefreshCustomGroup,
    autoRefreshCustomValue,
    autoRefreshCustomUnit,
    autoRefresh.intervalMinutes,
  );
  setRefreshControlsDisabled(
    !autoRefresh.enabled,
    autoRefreshInterval,
    autoRefreshCustomValue,
    autoRefreshCustomUnit,
  );
}

addRulePackButton.addEventListener("click", () => openRuleEditor());
rulePackToggle.addEventListener("click", () => {
  ruleListExpanded = !ruleListExpanded;
  renderRulePackList(rulePackSettings);
});
ruleEditorCloseButton.addEventListener("click", closeRuleEditor);
ruleEditorCancelButton.addEventListener("click", closeRuleEditor);
ruleEditorDialog.addEventListener("click", (event) => { if (event.target === ruleEditorDialog) closeRuleEditor(); });
ruleEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveRuleEditor().catch((error) => showToast(error instanceof Error ? error.message : "规则保存失败", "error"));
});
ruleEditorRefreshButton.addEventListener("click", () => {
  void refreshEditingRule().catch((error) => showToast(error instanceof Error ? error.message : "规则更新失败", "error"));
});
ruleEditorDeleteButton.addEventListener("click", () => {
  void deleteEditingRule().catch((error) => showToast(error instanceof Error ? error.message : "规则删除失败", "error"));
});
ruleEditorSourceStrategySelect.addEventListener("change", renderSourceStrategyHint);
ruleEditorFilePickerButton.addEventListener("click", () => ruleEditorFileInput.click());
ruleEditorFileInput.addEventListener("change", () => {
  void readLocalRuleFile().catch((error) => {
    showToast(error instanceof Error ? error.message : "本地规则文件读取失败", "error");
  });
});
ruleEditorViewRemoteButton.addEventListener("click", openRemoteRuleContent);
remoteRuleContentCloseButton.addEventListener("click", () => remoteRuleContentDialog.close());
remoteRuleContentDialog.addEventListener("click", (event) => {
  if (event.target === remoteRuleContentDialog) remoteRuleContentDialog.close();
});

refreshEnabledRulesButton.addEventListener("click", () => {
  refreshEnabledRulesButton.disabled = true;
  void sendMessage<{ refreshed: number; cached: number; failed: number; skipped: number }>({
    type: "REFRESH_ENABLED_RULE_PACKS",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.error ?? "规则更新失败");
      await reloadRuleSettings();
      showToast(
        response.message ?? "规则更新完成",
        response.data && (response.data.cached > 0 || response.data.failed > 0) ? "warning" : "success",
      );
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "规则更新失败", "error"))
    .finally(() => { refreshEnabledRulesButton.disabled = false; });
});

ruleMatchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage<{
    hostname: string;
    action: "DIRECT" | "PROXY" | "SYSTEM";
    matched: boolean;
    rule?: { type: string; value: string };
  }>({ type: "TEST_RULE_MATCH", input: ruleMatchInput.value })
    .then((response) => {
      if (!response.ok || !response.data) throw new Error(response.error ?? "规则匹配失败");
      const action = response.data.action === "PROXY" ? "代理" : response.data.action === "SYSTEM" ? "系统代理" : "直连";
      showToast(response.data.matched && response.data.rule
        ? `${response.data.hostname} → ${action} · 命中 ${response.data.rule.type},${response.data.rule.value}`
        : `${response.data.hostname} → ${action} · MATCH`, "info");
    })
    .catch((error) => showToast(error instanceof Error ? error.message : "规则匹配失败", "error"));
});

autoRefreshEnabled.addEventListener("change", () => {
  void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error"));
});
autoRefreshInterval.addEventListener("change", () => {
  const custom = autoRefreshInterval.value === "custom";
  autoRefreshCustomGroup.hidden = !custom;
  if (custom) {
    autoRefreshCustomValue.focus();
    autoRefreshCustomValue.select();
    return;
  }
  void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error"));
});
autoRefreshCustomValue.addEventListener("change", () => {
  void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error"));
});
autoRefreshCustomUnit.addEventListener("change", () => {
  setCustomIntervalInputLimit(autoRefreshCustomValue, autoRefreshCustomUnit.value as RefreshUnit);
  void saveAutoRefreshSettings().catch((error) => showToast(error instanceof Error ? error.message : "保存失败", "error"));
});
fallbackModeElement.addEventListener("change", () => {
  void saveFallbackMode().catch((error: unknown) => {
    showToast(error instanceof Error ? error.message : "MATCH 策略保存失败", "error");
  });
});
