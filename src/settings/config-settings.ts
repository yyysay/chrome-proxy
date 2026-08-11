import {
  extractDisabledConfigRules,
  SAMPLE_CONFIG_YAML,
  serializeConfigDocument,
  validateConfigDocument,
  type MinimalConfigDocument,
} from "../config/config-document.ts";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  formatRefreshInterval,
  REFRESH_INTERVAL_OPTIONS,
} from "../config/refresh-interval.ts";
import { requiredElement } from "./dom.ts";
import { resetNetworkInfo, setNetworkNodes } from "./network-info.ts";
import { formatDateTime, relativeTimeLabel } from "./relative-time.ts";
import { fetchRemoteYaml, requestUrlPermissions, sendMessage } from "./runtime-client.ts";
import { setStatusBadge } from "./status-badge.ts";
import { showToast } from "./toast.ts";

const configForm = requiredElement<HTMLFormElement>("#config-test-form");
const remoteConfigForm = requiredElement<HTMLFormElement>("#remote-config-form");
const remoteConfigInput = requiredElement<HTMLInputElement>("#remote-config-url");
const remoteConfigInterval = requiredElement<HTMLSelectElement>("#remote-config-interval");
const remoteConfigButton = requiredElement<HTMLButtonElement>("#sync-remote-config");
const configInput = requiredElement<HTMLTextAreaElement>("#config-test-input");
const syncStatus = requiredElement<HTMLElement>("#config-sync-status");
const runtimeBadge = requiredElement<HTMLElement>("#config-runtime-badge");
const resetSampleButton = requiredElement<HTMLButtonElement>("#reset-config-sample");
const applyButton = requiredElement<HTMLButtonElement>('#config-test-form button[type="submit"]');
const refreshProvidersButton = requiredElement<HTMLButtonElement>("#refresh-config-providers");
const nodeList = requiredElement<HTMLElement>("#visual-node-list");
const providerList = requiredElement<HTMLElement>("#visual-provider-list");
const ruleList = requiredElement<HTMLElement>("#visual-rule-list");
const nodeCount = requiredElement<HTMLElement>("#visual-node-count");
const providerCount = requiredElement<HTMLElement>("#visual-provider-count");
const ruleCount = requiredElement<HTMLElement>("#visual-rule-count");
const addNodeButton = requiredElement<HTMLButtonElement>("#add-visual-node");
const addProviderButton = requiredElement<HTMLButtonElement>("#add-visual-provider");
const addRuleButton = requiredElement<HTMLButtonElement>("#add-visual-rule");
const providerDialog = requiredElement<HTMLDialogElement>("#provider-content-dialog");
const providerDialogTitle = requiredElement<HTMLElement>("#provider-content-title");
const providerDialogMeta = requiredElement<HTMLElement>("#provider-content-meta");
const providerDialogBody = requiredElement<HTMLElement>("#provider-content-body");
const closeProviderDialog = requiredElement<HTMLButtonElement>("#close-provider-content");

const FIELD_CLASS = "min-w-0 rounded-lg border border-black/[.055] bg-white px-2.5 py-2 text-xs outline-none ring-[#007aff]/20 transition duration-150 focus:border-transparent focus:ring-2 dark:border-white/10 dark:bg-[#101012] dark:text-[#f5f5f7]";
const DELETE_CLASS = "shrink-0 rounded-full px-2 py-2 text-xs font-medium text-stone-300 transition hover:bg-[#ff3b30]/8 hover:text-[#ff3b30] dark:text-white/20 dark:hover:text-[#ff6961]";
const LOCAL_TYPES = ["DOMAIN", "DOMAIN-SUFFIX", "IP-CIDR"] as const;
let visualDocument: MinimalConfigDocument;
let visualRules: Array<{ value: string; enabled: boolean }> = [];
let runtimeState: ConfigDocumentState;
let yamlSyncTimer: number | undefined;

fillIntervalSelect(remoteConfigInterval, DEFAULT_REFRESH_INTERVAL_SECONDS, true);

function input(value: string, placeholder: string, type = "text"): HTMLInputElement {
  const element = document.createElement("input");
  element.className = FIELD_CLASS;
  element.type = type;
  element.value = value;
  element.placeholder = placeholder;
  return element;
}

function select(values: readonly string[], selected: string): HTMLSelectElement {
  const element = document.createElement("select");
  element.className = FIELD_CLASS;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "选择类型";
    element.append(option);
  }
  element.value = selected;
  return element;
}

function fillIntervalSelect(element: HTMLSelectElement, interval: number, allowDisabled = false): void {
  element.replaceChildren();
  const selected = String(interval);
  if (allowDisabled) {
    const disabled = document.createElement("option");
    disabled.value = "0";
    disabled.textContent = "不自动更新";
    element.append(disabled);
  }
  if (interval > 0 && !REFRESH_INTERVAL_OPTIONS.some(({ seconds }) => String(seconds) === selected)) {
    const custom = document.createElement("option");
    custom.value = selected;
    custom.textContent = formatRefreshInterval(interval);
    element.append(custom);
  }
  for (const { seconds, label } of REFRESH_INTERVAL_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(seconds);
    option.textContent = label;
    element.append(option);
  }
  element.value = selected;
}

function providerIntervalSelect(interval: number): HTMLSelectElement {
  const element = document.createElement("select");
  element.className = FIELD_CLASS;
  fillIntervalSelect(element, interval);
  element.title = "规则包自动更新周期";
  element.setAttribute("aria-label", "规则包自动更新周期");
  return element;
}

function deleteButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = DELETE_CLASS;
  button.textContent = "删除";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", action);
  return button;
}

function labeled(control: HTMLInputElement | HTMLSelectElement, label: string): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "grid min-w-0 gap-1.5";
  const caption = document.createElement("span");
  caption.className = "px-0.5 text-[11px] font-medium text-stone-400 dark:text-white/35";
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function emptyState(container: HTMLElement, text: string): void {
  const empty = document.createElement("p");
  empty.className = "rounded-2xl border border-dashed border-black/10 px-4 py-8 text-center text-xs text-stone-400 dark:border-white/10 dark:text-white/30";
  empty.textContent = text;
  container.append(empty);
}

function row(className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `grid items-end gap-2.5 rounded-[20px] border border-black/[.07] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,.04)] dark:border-white/10 dark:bg-[#1c1c1e] ${className}`;
  return element;
}

function renderSyncStatus(result: ReturnType<typeof validateConfigDocument>): void {
  if (!result.ok || !result.summary) {
    syncStatus.hidden = false;
    syncStatus.className = "mb-2 text-xs text-red-600 dark:text-[#ff6961]";
    syncStatus.textContent = result.issues[0] ?? "配置无效";
    return;
  }
  syncStatus.hidden = true;
  syncStatus.textContent = "";
}

function writeYamlFromVisual(rerender = false): void {
  visualDocument.rules = visualRules.filter((rule) => rule.enabled).map((rule) => rule.value);
  configInput.value = serializeConfigDocument(
    visualDocument,
    visualRules.filter((rule) => !rule.enabled).map((rule) => rule.value),
  );
  renderSyncStatus(validateConfigDocument(configInput.value));
  if (rerender) renderVisualEditor();
}

function syncVisualFromYaml(): void {
  const result = validateConfigDocument(configInput.value);
  renderSyncStatus(result);
  if (!result.ok || !result.document) return;
  visualDocument = structuredClone(result.document);
  const match = visualDocument.rules.find((rule) => rule.toUpperCase().startsWith("MATCH,"));
  visualRules = [
    ...visualDocument.rules.filter((rule) => rule !== match).map((value) => ({ value, enabled: true })),
    ...extractDisabledConfigRules(configInput.value).map((value) => ({ value, enabled: false })),
    ...(match ? [{ value: match, enabled: true }] : []),
  ];
  renderVisualEditor();
}

function renderRuntime(state: ConfigDocumentState): void {
  runtimeState = state;
  setStatusBadge(runtimeBadge, state.active ? "已应用" : "未应用", state.active ? "fresh" : "idle");
  refreshProvidersButton.disabled = !state.active || Object.keys(visualDocument?.ruleProviders ?? {}).length === 0;
}

function renderSource(state: ConfigDocumentState): void {
  remoteConfigInput.value = state.sourceUrl;
  fillIntervalSelect(remoteConfigInterval, state.remote.intervalSeconds, true);
}

async function showProviderContent(name: string): Promise<void> {
  const response = await sendMessage<{
    name: string;
    content: string;
    ruleCount: number;
    fetchedAt: string;
    lastAttemptAt: string;
    status: "ready" | "cached";
    error?: string;
  }>({ type: "GET_CONFIG_PROVIDER_CONTENT", name });
  if (!response.ok || !response.data) throw new Error(response.error ?? "规则包内容读取失败");
  providerDialogTitle.textContent = response.data.name;
  providerDialogMeta.textContent = `${response.data.ruleCount} 条规则 · 更新于 ${formatDateTime(response.data.fetchedAt)}${response.data.status === "cached" ? " · 当前使用缓存" : ""}`;
  providerDialogBody.textContent = response.data.content;
  providerDialog.showModal();
}

function renderNodes(): void {
  nodeList.replaceChildren();
  nodeCount.textContent = String(visualDocument.proxies.length);
  visualDocument.proxies.forEach((node, index) => {
    const card = row("grid-cols-[minmax(90px,.8fr)_minmax(140px,1.4fr)_80px_auto]");
    const name = input(node.name, "节点名称");
    const server = input(node.server, "主机或 IP");
    const port = input(String(node.port), "端口", "number");
    let previousName = node.name;
    port.min = "1"; port.max = "65535";
    name.addEventListener("input", () => {
      const oldName = previousName;
      node.name = name.value;
      visualRules = visualRules.map((rule) => {
        const parts = rule.value.split(",").map((part) => part.trim());
        const targetIndex = parts[0]?.toUpperCase() === "MATCH" ? 1 : 2;
        if (parts[targetIndex] === previousName) parts[targetIndex] = node.name;
        return { ...rule, value: parts.join(",") };
      });
      for (const targetSelect of ruleList.querySelectorAll<HTMLSelectElement>('select[data-rule-target="true"]')) {
        const wasSelected = targetSelect.value === oldName;
        const option = Array.from(targetSelect.options).find((item) => item.value === oldName);
        if (option) { option.value = node.name; option.textContent = node.name; }
        if (wasSelected) targetSelect.value = node.name;
      }
      previousName = node.name;
      writeYamlFromVisual();
    });
    name.addEventListener("change", () => renderVisualEditor());
    server.addEventListener("input", () => { node.server = server.value; writeYamlFromVisual(); });
    port.addEventListener("input", () => { node.port = Number(port.value); writeYamlFromVisual(); });
    card.append(labeled(name, "名称"), labeled(server, "服务器"), labeled(port, "端口"), deleteButton(`删除节点 ${node.name}`, () => {
      visualDocument.proxies.splice(index, 1);
      writeYamlFromVisual(true);
    }));
    nodeList.append(card);
  });
  if (visualDocument.proxies.length === 0) emptyState(nodeList, "还没有节点");
}

function renderProviders(): void {
  providerList.replaceChildren();
  providerCount.textContent = String(Object.keys(visualDocument.ruleProviders).length);
  Object.values(visualDocument.ruleProviders).forEach((provider) => {
    const status = runtimeState?.providers[provider.name];
    const container = document.createElement("div");
    container.className = "group overflow-hidden rounded-[22px] border border-black/[.07] bg-white px-3 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,.045)] dark:border-white/10 dark:bg-[#1c1c1e]";
    const summary = document.createElement("div");
    summary.className = "grid grid-cols-[minmax(0,1fr)_82px_70px_112px_76px_48px_48px_44px] items-center gap-2";
    const name = input(provider.name, "规则包名称");
    const url = input(provider.url, "https://…", "url");
    const behavior = select(["domain", "ipcidr", "classical"], provider.behavior);
    const format = select(["yaml", "list"], provider.format);
    const interval = providerIntervalSelect(provider.interval);
    name.className = "min-w-0 bg-transparent text-sm font-semibold outline-none";
    url.className = "w-full rounded-xl border border-black/[.055] bg-[#f5f5f7] px-3 py-2.5 text-xs outline-none ring-[#007aff]/20 focus:border-transparent focus:ring-2 dark:border-white/10 dark:bg-[#101012]";
    for (const control of [behavior, format, interval]) {
      control.className = "min-w-0 rounded-full border-0 bg-black/[.04] px-2.5 py-2 text-xs font-medium outline-none dark:bg-white/8 dark:text-white/65";
    }
    const identity = document.createElement("label");
    identity.className = "grid min-w-0 border-r border-black/[.055] pr-3 dark:border-white/10";
    identity.append(name);
    const urlEditor = document.createElement("div");
    urlEditor.className = "mt-2 hidden border-t border-black/[.055] px-1 pt-2 dark:border-white/10";
    urlEditor.append(labeled(url, "订阅地址"));
    let currentKey = provider.name;
    name.addEventListener("input", () => {
      delete visualDocument.ruleProviders[currentKey];
      provider.name = name.value;
      visualRules = visualRules.map((rule) => {
        const parts = rule.value.split(",").map((part) => part.trim());
        if (parts[0]?.toUpperCase() === "RULE-SET" && parts[1] === currentKey) parts[1] = provider.name;
        return { ...rule, value: parts.join(",") };
      });
      for (const sourceSelect of ruleList.querySelectorAll<HTMLSelectElement>('select[data-provider-ref="true"]')) {
        const wasSelected = sourceSelect.value === currentKey;
        const option = Array.from(sourceSelect.options).find((item) => item.value === currentKey);
        if (option) { option.value = provider.name; option.textContent = provider.name; }
        if (wasSelected) sourceSelect.value = provider.name;
      }
      currentKey = provider.name;
      visualDocument.ruleProviders[currentKey] = provider;
      writeYamlFromVisual();
    });
    name.addEventListener("change", () => renderVisualEditor());
    url.addEventListener("input", () => { provider.url = url.value; writeYamlFromVisual(); });
    behavior.addEventListener("change", () => { provider.behavior = behavior.value as typeof provider.behavior; writeYamlFromVisual(); });
    format.addEventListener("change", () => { provider.format = format.value as typeof provider.format; writeYamlFromVisual(); });
    interval.addEventListener("change", () => { provider.interval = Number(interval.value); writeYamlFromVisual(); });
    const remove = deleteButton(`删除规则包 ${provider.name}`, () => {
      delete visualDocument.ruleProviders[currentKey];
      writeYamlFromVisual(true);
    });
    const updateSchedule = `${formatRefreshInterval(provider.interval)}自动更新`;
    const statusDetail = !status || status.status === "missing"
      ? `尚未更新 · ${updateSchedule}`
      : status.status === "cached"
        ? `更新失败，使用 ${status.ruleCount ?? 0} 条缓存 · 最近尝试 ${relativeTimeLabel(status.lastAttemptAt)} · ${updateSchedule}`
        : `已更新 ${status.ruleCount ?? 0} 条 · ${relativeTimeLabel(status.fetchedAt)} · ${updateSchedule}`;
    const statusChip = document.createElement("span");
    statusChip.className = status?.status === "ready"
      ? "truncate rounded-full bg-[#34c759]/12 px-2 py-1.5 text-center text-xs font-medium text-[#248a3d] dark:text-[#30d158]"
      : status?.status === "cached"
        ? "truncate rounded-full bg-[#ff3b30]/10 px-2 py-1.5 text-center text-xs font-medium text-[#d70015] dark:text-[#ff6961]"
        : "truncate rounded-full bg-[#ff9f0a]/12 px-2 py-1.5 text-center text-xs font-medium text-[#b25000] dark:text-[#ff9f0a]";
    statusChip.textContent = status?.status === "ready"
      ? `${status.ruleCount ?? 0} 条`
      : status?.status === "cached"
        ? "使用缓存"
        : "未更新";
    statusChip.title = statusDetail;
    const view = document.createElement("button");
    view.type = "button";
    view.className = "rounded-full px-1 py-2 text-center text-xs font-medium text-[#007aff] transition hover:bg-[#007aff]/8 disabled:text-stone-300 dark:text-[#0a84ff] dark:disabled:text-white/20";
    view.textContent = "查看";
    view.disabled = !status || status.status === "missing";
    view.addEventListener("click", () => void showProviderContent(provider.name)
      .catch((error) => showToast(error instanceof Error ? error.message : "规则包内容读取失败", "error")));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "rounded-full px-1 py-2 text-center text-xs font-medium text-stone-400 transition hover:bg-black/[.035] hover:text-stone-700 dark:text-white/35 dark:hover:bg-white/8 dark:hover:text-white/70";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => {
      const opening = urlEditor.classList.contains("hidden");
      urlEditor.classList.toggle("hidden", !opening);
      edit.textContent = opening ? "完成" : "编辑";
      if (opening) { url.focus(); url.select(); }
    });
    summary.append(identity, behavior, format, interval, statusChip, view, edit, remove);
    container.append(summary, urlEditor);
    providerList.append(container);
  });
  if (Object.keys(visualDocument.ruleProviders).length === 0) emptyState(providerList, "还没有远程规则包");
}

function ruleTargetOptions(): string[] {
  return ["DIRECT", ...visualDocument.proxies.map((node) => node.name).filter(Boolean)];
}

function updateRule(index: number, type: string, middle: string, target: string): void {
  visualRules[index].value = type === "MATCH" ? `MATCH,${target}` : `${type},${middle},${target}`;
  writeYamlFromVisual();
}

function renderRules(): void {
  ruleList.replaceChildren();
  ruleCount.textContent = `${visualRules.filter((rule) => rule.enabled).length}/${visualRules.length}`;
  visualRules.forEach((visualRule, index) => {
    const rawRule = visualRule.value;
    const parts = rawRule.split(",").map((part) => part.trim());
    const type = parts[0]?.toUpperCase() || "";
    const currentMiddle = type === "MATCH" ? "" : parts[1] ?? "";
    const currentTarget = type === "MATCH" ? parts[1] ?? "DIRECT" : parts[2] ?? "DIRECT";
    const isMatch = type === "MATCH";
    const card = row(isMatch
      ? "grid-cols-[112px_minmax(0,1fr)_112px_44px]"
      : "grid-cols-[44px_112px_minmax(0,1fr)_112px_44px]");
    card.className = card.className.replace("items-end", "items-center").replace(" p-3 ", " p-2.5 ");
    card.classList.toggle("opacity-55", !visualRule.enabled);
    let toggle: HTMLButtonElement | undefined;
    if (!isMatch) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.role = "switch";
      toggle.setAttribute("aria-checked", String(visualRule.enabled));
      toggle.setAttribute("aria-label", `${visualRule.enabled ? "停用" : "启用"}规则 ${rawRule}`);
      toggle.title = visualRule.enabled ? "停用规则" : "启用规则";
      toggle.className = visualRule.enabled
        ? "relative h-6 w-10 rounded-full bg-[#34c759] transition"
        : "relative h-6 w-10 rounded-full bg-stone-300 transition dark:bg-white/15";
      const thumb = document.createElement("span");
      thumb.className = visualRule.enabled
        ? "absolute left-1 top-1 size-4 translate-x-4 rounded-full bg-white shadow-sm transition"
        : "absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition";
      toggle.append(thumb);
      toggle.addEventListener("click", () => {
        visualRule.enabled = !visualRule.enabled;
        writeYamlFromVisual(true);
      });
    }
    const typeSelect = isMatch ? undefined : select(["", "RULE-SET", ...LOCAL_TYPES], type);
    const target = select(ruleTargetOptions(), currentTarget);
    target.className = "min-w-0 rounded-full border-0 bg-black/[.04] px-3 py-2 text-xs font-medium outline-none dark:bg-white/8 dark:text-white/65";
    target.dataset.ruleTarget = "true";
    let middle: HTMLInputElement | HTMLSelectElement | undefined;
    if (type === "RULE-SET") {
      middle = select(Object.keys(visualDocument.ruleProviders), currentMiddle);
      middle.dataset.providerRef = "true";
    }
    else if (type !== "MATCH") middle = input(currentMiddle, "匹配内容");
    for (const control of [typeSelect, middle].filter(Boolean) as Array<HTMLInputElement | HTMLSelectElement>) {
      control.className = "min-w-0 rounded-full border-0 bg-black/[.04] px-3 py-2 text-xs font-medium outline-none dark:bg-white/8 dark:text-white/65";
    }
    typeSelect?.addEventListener("change", () => {
      const nextType = typeSelect.value;
      const nextMiddle = nextType === "RULE-SET"
        ? Object.keys(visualDocument.ruleProviders)[0] ?? ""
        : currentMiddle;
      updateRule(index, nextType, nextMiddle, target.value || "DIRECT");
      renderVisualEditor();
    });
    const selectedType = (): string => typeSelect?.value ?? "MATCH";
    middle?.addEventListener("input", () => updateRule(index, selectedType(), middle?.value ?? "", target.value));
    middle?.addEventListener("change", () => updateRule(index, selectedType(), middle?.value ?? "", target.value));
    target.addEventListener("change", () => updateRule(index, selectedType(), middle?.value ?? "", target.value));
    if (isMatch) {
      const matchLabel = document.createElement("strong");
      matchLabel.className = "px-3 text-xs font-semibold tracking-wide text-stone-500 dark:text-white/55";
      matchLabel.textContent = "MATCH";
      const spacer = document.createElement("span");
      const actionSpacer = document.createElement("span");
      card.append(matchLabel, spacer, target, actionSpacer);
    } else if (toggle && typeSelect && middle) {
      card.append(toggle, typeSelect, middle, target, deleteButton(`删除规则 ${rawRule}`, () => {
        visualRules.splice(index, 1);
        writeYamlFromVisual(true);
      }));
    } else if (toggle && typeSelect) {
      const spacer = document.createElement("span");
      card.append(toggle, typeSelect, spacer, target, deleteButton(`删除规则 ${rawRule}`, () => {
        visualRules.splice(index, 1);
        writeYamlFromVisual(true);
      }));
    }
    ruleList.append(card);
  });
  if (visualRules.length === 0) emptyState(ruleList, "还没有规则");
}

function renderVisualEditor(): void {
  renderNodes();
  renderRules();
  renderProviders();
  if (runtimeState) renderRuntime(runtimeState);
}

function insertBeforeMatch(rule: string): void {
  const matchIndex = visualRules.findIndex((item) => item.value.toUpperCase().startsWith("MATCH,"));
  visualRules.splice(matchIndex >= 0 ? matchIndex : visualRules.length, 0, { value: rule, enabled: true });
  writeYamlFromVisual(true);
}

export function initializeConfigSettings(state: ConfigDocumentState): void {
  runtimeState = state;
  configInput.value = state.yaml || SAMPLE_CONFIG_YAML;
  syncVisualFromYaml();
  renderRuntime(state);
  renderSource(state);
}

configInput.addEventListener("input", () => {
  window.clearTimeout(yamlSyncTimer);
  yamlSyncTimer = window.setTimeout(syncVisualFromYaml, 220);
});

async function applyDocument(yaml: string, sourceUrl = "", refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS): Promise<void> {
    const validation = validateConfigDocument(yaml);
    renderSyncStatus(validation);
    if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
    const activeProviders = new Set(validation.document.rules.flatMap((rule) => {
      const parts = rule.split(",").map((part) => part.trim());
      return parts[0]?.toUpperCase() === "RULE-SET" && parts[1] ? [parts[1]] : [];
    }));
    await requestUrlPermissions(Object.values(validation.document.ruleProviders)
      .filter((provider) => activeProviders.has(provider.name))
      .map((provider) => provider.url));
    const response = await sendMessage<{ state: ConfigDocumentState; refreshed: number; cached: number; pacReapplied: boolean }>({
      type: "APPLY_CONFIG_DOCUMENT",
      yaml,
      sourceUrl,
      refreshIntervalSeconds,
    });
    if (!response.ok || !response.data) throw new Error(response.error ?? "配置应用失败");
    renderRuntime(response.data.state);
    configInput.value = yaml;
    syncVisualFromYaml();
    renderSource(response.data.state);
    setNetworkNodes(response.data.state.nodes);
    resetNetworkInfo();
    showToast(response.message ?? "配置已保存并应用", response.data.cached > 0 ? "warning" : "success");
}

remoteConfigForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    remoteConfigButton.disabled = true;
    const remote = await fetchRemoteYaml(remoteConfigInput.value);
    await applyDocument(remote.yaml, remote.url, Number(remoteConfigInterval.value));
  })().catch((error) => {
    showToast(error instanceof Error ? error.message : "远程配置同步失败", "error");
  }).finally(() => { remoteConfigButton.disabled = false; });
});

configForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    let sourceUrl = runtimeState.sourceUrl;
    let refreshIntervalSeconds = runtimeState.remote.intervalSeconds;
    const manuallyChanged = configInput.value !== runtimeState.yaml;
    if (sourceUrl && manuallyChanged) {
      if (Number(remoteConfigInterval.value) > 0) {
        const confirmed = window.confirm("远程订阅自动更新会覆盖手动修改。继续保存将关闭自动更新，但保留订阅地址，之后只能手动同步。是否继续？");
        if (!confirmed) return;
      }
      refreshIntervalSeconds = 0;
    }
    applyButton.disabled = true;
    await applyDocument(configInput.value, sourceUrl, refreshIntervalSeconds);
  })().catch((error) => showToast(error instanceof Error ? error.message : "配置应用失败", "error"))
    .finally(() => { applyButton.disabled = false; });
});

refreshProvidersButton.addEventListener("click", () => {
  void (async () => {
    refreshProvidersButton.disabled = true;
    const response = await sendMessage<{ state: ConfigDocumentState; refreshed: number; cached: number }>({ type: "REFRESH_CONFIG_PROVIDERS" });
    if (!response.ok || !response.data) throw new Error(response.error ?? "规则包更新失败");
    renderRuntime(response.data.state);
    renderProviders();
    showToast(response.message ?? "规则包已更新", response.data.cached > 0 ? "warning" : "success");
  })().catch((error) => showToast(error instanceof Error ? error.message : "规则包更新失败", "error"))
    .finally(() => renderRuntime(runtimeState));
});

resetSampleButton.addEventListener("click", () => { configInput.value = SAMPLE_CONFIG_YAML; syncVisualFromYaml(); });
addNodeButton.addEventListener("click", () => {
  const index = visualDocument.proxies.length + 1;
  visualDocument.proxies.push({ name: `节点 ${index}`, type: "http", server: "127.0.0.1", port: 7890 });
  writeYamlFromVisual(true);
});
addProviderButton.addEventListener("click", () => {
  let index = Object.keys(visualDocument.ruleProviders).length + 1;
  while (visualDocument.ruleProviders[`provider-${index}`]) index += 1;
  const name = `provider-${index}`;
  visualDocument.ruleProviders[name] = { name, url: "https://example.com/rules.yaml", behavior: "domain", format: "yaml", interval: 86400 };
  writeYamlFromVisual(true);
});
addRuleButton.addEventListener("click", () => {
  insertBeforeMatch(",,DIRECT");
});
closeProviderDialog.addEventListener("click", () => providerDialog.close());
providerDialog.addEventListener("click", (event) => {
  if (event.target === providerDialog) providerDialog.close();
});
