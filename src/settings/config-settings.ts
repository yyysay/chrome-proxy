import {
  SAMPLE_CONFIG_YAML,
  serializeConfigDocument,
  validateConfigDocument,
  type MinimalConfigDocument,
} from "../config/config-document.ts";
import type { ConfigDocumentState } from "../config/config-runtime.ts";
import { requiredElement } from "./dom.ts";
import { resetNetworkInfo, setNetworkNodes } from "./network-info.ts";
import { fetchRemoteYaml, requestUrlPermissions, sendMessage } from "./runtime-client.ts";
import { setStatusBadge } from "./status-badge.ts";
import { showToast } from "./toast.ts";

const configForm = requiredElement<HTMLFormElement>("#config-test-form");
const remoteConfigForm = requiredElement<HTMLFormElement>("#remote-config-form");
const remoteConfigInput = requiredElement<HTMLInputElement>("#remote-config-url");
const remoteConfigHint = requiredElement<HTMLElement>("#remote-config-hint");
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
const addNodeButton = requiredElement<HTMLButtonElement>("#add-visual-node");
const addProviderButton = requiredElement<HTMLButtonElement>("#add-visual-provider");
const addRulesetButton = requiredElement<HTMLButtonElement>("#add-visual-ruleset");
const addLocalRuleButton = requiredElement<HTMLButtonElement>("#add-visual-local-rule");

const FIELD_CLASS = "min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs outline-none focus:border-stone-500 dark:border-[#545458]/65 dark:bg-[#161618] dark:text-[#f5f5f7]";
const DELETE_CLASS = "shrink-0 rounded-lg px-2 py-2 text-xs font-extrabold text-red-500 hover:bg-red-50 dark:hover:bg-[#ff453a]/10";
const LOCAL_TYPES = ["DOMAIN", "DOMAIN-SUFFIX", "IP-CIDR"] as const;
let visualDocument: MinimalConfigDocument;
let runtimeState: ConfigDocumentState;
let yamlSyncTimer: number | undefined;

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
    option.textContent = value;
    element.append(option);
  }
  element.value = selected;
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

function row(className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `grid items-center gap-2 rounded-lg border border-stone-200 bg-white p-2 dark:border-white/10 dark:bg-[#2c2c2e] ${className}`;
  return element;
}

function renderSyncStatus(result: ReturnType<typeof validateConfigDocument>): void {
  if (!result.ok || !result.summary) {
    syncStatus.className = "mb-2 min-h-5 text-xs text-red-600 dark:text-[#ff6961]";
    syncStatus.textContent = result.issues[0] ?? "配置无效";
    return;
  }
  syncStatus.className = "mb-2 min-h-5 text-xs text-stone-400 dark:text-white/40";
  syncStatus.textContent = `${result.summary.proxies} 节点 · ${result.summary.ruleProviders} 远程规则包 · ${result.summary.localRules} 本地规则`;
}

function writeYamlFromVisual(rerender = false): void {
  configInput.value = serializeConfigDocument(visualDocument);
  renderSyncStatus(validateConfigDocument(configInput.value));
  if (rerender) renderVisualEditor();
}

function syncVisualFromYaml(): void {
  const result = validateConfigDocument(configInput.value);
  renderSyncStatus(result);
  if (!result.ok || !result.document) return;
  visualDocument = structuredClone(result.document);
  renderVisualEditor();
}

function renderRuntime(state: ConfigDocumentState): void {
  runtimeState = state;
  setStatusBadge(runtimeBadge, state.active ? "已应用" : "未应用", state.active ? "fresh" : "idle");
  refreshProvidersButton.disabled = !state.active || Object.keys(visualDocument?.ruleProviders ?? {}).length === 0;
}

function renderSource(state: ConfigDocumentState): void {
  remoteConfigInput.value = state.sourceUrl;
  remoteConfigHint.textContent = state.sourceUrl
    ? `当前来源：${state.sourceUrl}`
    : "当前使用手动 YAML；填写订阅地址可切换为远程配置。";
}

function renderNodes(): void {
  nodeList.replaceChildren();
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
      visualDocument.rules = visualDocument.rules.map((rule) => {
        const parts = rule.split(",").map((part) => part.trim());
        const targetIndex = parts[0]?.toUpperCase() === "MATCH" ? 1 : 2;
        if (parts[targetIndex] === previousName) parts[targetIndex] = node.name;
        return parts.join(",");
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
    card.append(name, server, port, deleteButton(`删除节点 ${node.name}`, () => {
      visualDocument.proxies.splice(index, 1);
      writeYamlFromVisual(true);
    }));
    nodeList.append(card);
  });
  if (visualDocument.proxies.length === 0) nodeList.textContent = "暂无节点";
}

function renderProviders(): void {
  providerList.replaceChildren();
  Object.values(visualDocument.ruleProviders).forEach((provider) => {
    const card = row("grid-cols-[82px_minmax(110px,1fr)_78px_68px_72px_auto]");
    const name = input(provider.name, "规则包名称");
    const url = input(provider.url, "https://…", "url");
    const behavior = select(["domain", "ipcidr", "classical"], provider.behavior);
    const format = select(["yaml", "list"], provider.format);
    const interval = input(String(provider.interval), "秒", "number");
    let currentKey = provider.name;
    name.addEventListener("input", () => {
      delete visualDocument.ruleProviders[currentKey];
      provider.name = name.value;
      visualDocument.rules = visualDocument.rules.map((rule) => {
        const parts = rule.split(",").map((part) => part.trim());
        if (parts[0]?.toUpperCase() === "RULE-SET" && parts[1] === currentKey) parts[1] = provider.name;
        return parts.join(",");
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
    interval.addEventListener("input", () => { provider.interval = Number(interval.value); writeYamlFromVisual(); });
    const remove = deleteButton(`删除规则包 ${provider.name}`, () => {
      delete visualDocument.ruleProviders[currentKey];
      writeYamlFromVisual(true);
    });
    const status = runtimeState?.providers[provider.name];
    if (status) remove.title = status.status === "cached" ? "当前使用缓存" : status.status === "ready" ? "缓存已更新" : "尚无缓存";
    card.append(name, url, behavior, format, interval, remove);
    providerList.append(card);
  });
  if (Object.keys(visualDocument.ruleProviders).length === 0) providerList.textContent = "暂无远程规则包";
}

function ruleTargetOptions(): string[] {
  return ["DIRECT", ...visualDocument.proxies.map((node) => node.name).filter(Boolean)];
}

function updateRule(index: number, type: string, middle: string, target: string): void {
  visualDocument.rules[index] = type === "MATCH" ? `MATCH,${target}` : `${type},${middle},${target}`;
  writeYamlFromVisual();
}

function renderRules(): void {
  ruleList.replaceChildren();
  visualDocument.rules.forEach((rawRule, index) => {
    const parts = rawRule.split(",").map((part) => part.trim());
    const type = parts[0]?.toUpperCase() || "DOMAIN";
    const currentMiddle = type === "MATCH" ? "" : parts[1] ?? "";
    const currentTarget = type === "MATCH" ? parts[1] ?? "DIRECT" : parts[2] ?? "DIRECT";
    const card = row(type === "MATCH" ? "grid-cols-[140px_minmax(160px,1fr)]" : "grid-cols-[140px_minmax(160px,1fr)_minmax(120px,.7fr)_auto]");
    const isMatch = type === "MATCH";
    const typeSelect = select(isMatch ? ["MATCH"] : ["RULE-SET", ...LOCAL_TYPES], type);
    typeSelect.disabled = isMatch;
    const target = select(ruleTargetOptions(), currentTarget);
    target.dataset.ruleTarget = "true";
    let middle: HTMLInputElement | HTMLSelectElement | undefined;
    if (type === "RULE-SET") {
      middle = select(Object.keys(visualDocument.ruleProviders), currentMiddle);
      middle.dataset.providerRef = "true";
    }
    else if (type !== "MATCH") middle = input(currentMiddle, "匹配内容");
    typeSelect.addEventListener("change", () => {
      const nextType = typeSelect.value;
      const nextMiddle = nextType === "RULE-SET"
        ? Object.keys(visualDocument.ruleProviders)[0] ?? ""
        : currentMiddle || "example.com";
      updateRule(index, nextType, nextMiddle, target.value || "DIRECT");
      renderVisualEditor();
    });
    middle?.addEventListener("input", () => updateRule(index, typeSelect.value, middle?.value ?? "", target.value));
    middle?.addEventListener("change", () => updateRule(index, typeSelect.value, middle?.value ?? "", target.value));
    target.addEventListener("change", () => updateRule(index, typeSelect.value, middle?.value ?? "", target.value));
    if (middle) card.append(typeSelect, middle, target);
    else card.append(typeSelect, target);
    if (!isMatch) {
      card.append(deleteButton(`删除规则 ${rawRule}`, () => {
        visualDocument.rules.splice(index, 1);
        writeYamlFromVisual(true);
      }));
    }
    ruleList.append(card);
  });
  if (visualDocument.rules.length === 0) ruleList.textContent = "暂无规则";
}

function renderVisualEditor(): void {
  renderNodes();
  renderProviders();
  renderRules();
  if (runtimeState) renderRuntime(runtimeState);
}

function insertBeforeMatch(rule: string): void {
  const matchIndex = visualDocument.rules.findIndex((item) => item.toUpperCase().startsWith("MATCH,"));
  visualDocument.rules.splice(matchIndex >= 0 ? matchIndex : visualDocument.rules.length, 0, rule);
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

async function applyDocument(yaml: string, sourceUrl = ""): Promise<void> {
    const validation = validateConfigDocument(yaml);
    renderSyncStatus(validation);
    if (!validation.ok || !validation.document) throw new Error(validation.issues[0] ?? "配置无效");
    await requestUrlPermissions(Object.values(validation.document.ruleProviders).map((provider) => provider.url));
    const response = await sendMessage<{ state: ConfigDocumentState; refreshed: number; cached: number; pacReapplied: boolean }>({ type: "APPLY_CONFIG_DOCUMENT", yaml, sourceUrl });
    if (!response.ok || !response.data) throw new Error(response.error ?? "配置应用失败");
    configInput.value = yaml;
    syncVisualFromYaml();
    renderRuntime(response.data.state);
    renderSource(response.data.state);
    setNetworkNodes(response.data.state.nodes);
    resetNetworkInfo();
    showToast(response.message ?? "配置已保存并应用", response.data.cached > 0 ? "warning" : "success");
}

remoteConfigForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    remoteConfigButton.disabled = true;
    remoteConfigHint.textContent = "正在下载并校验远程 YAML…";
    const remote = await fetchRemoteYaml(remoteConfigInput.value);
    await applyDocument(remote.yaml, remote.url);
  })().catch((error) => {
    remoteConfigHint.textContent = error instanceof Error ? error.message : "远程配置同步失败";
    showToast(remoteConfigHint.textContent, "error");
  }).finally(() => { remoteConfigButton.disabled = false; });
});

configForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    applyButton.disabled = true;
    await applyDocument(configInput.value);
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
addRulesetButton.addEventListener("click", () => insertBeforeMatch(`RULE-SET,${Object.keys(visualDocument.ruleProviders)[0] ?? "provider"},${visualDocument.proxies[0]?.name ?? "DIRECT"}`));
addLocalRuleButton.addEventListener("click", () => insertBeforeMatch("DOMAIN,example.com,DIRECT"));
