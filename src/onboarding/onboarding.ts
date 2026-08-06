import "./onboarding.css";
import {
  DEFAULT_RULE_PACKS,
  DEFAULT_ENABLED_RULE_PACK_IDS,
} from "../rule-packs/catalog";

const INSTALL_TIME_KEY = "installedAt";
const PROXY_CONFIG_KEY = "proxyConfig";
const ENABLED_RULE_PACK_IDS_KEY = "enabledRulePackIds";
const FALLBACK_MODE_KEY = "fallbackMode";
const UI_MODE_KEY = "uiMode";

type FallbackMode = "direct" | "proxy" | "system";

interface ProxyConfig {
  type: "http";
  host: string;
  port: number;
}

interface RulePackSetting {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  defaultAction: "DIRECT" | "PROXY";
  enabled: boolean;
  source: {
    url?: string;
    cachedContent?: string;
    customContent?: string;
    updatedAt?: string;
    lastAttemptAt?: string;
    status?: "idle" | "downloading" | "ready" | "cached" | "error";
    error?: string;
  };
  validation?: {
    effective: number;
    ignored: number;
  };
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`页面缺少必要元素：${selector}`);
  }

  return element;
}

const form = requiredElement<HTMLFormElement>("#proxy-form");
const hostInput = requiredElement<HTMLInputElement>("#proxy-host");
const portInput = requiredElement<HTMLInputElement>("#proxy-port");
const statusElement = requiredElement<HTMLElement>("#status");
const versionElement = requiredElement<HTMLElement>("#version");
const installedAtElement =
  requiredElement<HTMLElement>("#installed-at");
const rulePackListElement =
  requiredElement<HTMLElement>("#rule-pack-list");
const rulePackCountElement =
  requiredElement<HTMLElement>("#rule-pack-count");
const rulePackStatusElement =
  requiredElement<HTMLElement>("#rule-pack-status");
const fallbackModeElement =
  requiredElement<HTMLSelectElement>("#fallback-mode");
const fallbackDescriptionElement =
  requiredElement<HTMLElement>("#fallback-description");
const fallbackStatusElement =
  requiredElement<HTMLElement>("#fallback-status");
const addRulePackButton =
  requiredElement<HTMLButtonElement>("#add-rule-pack");
const refreshEnabledRulesButton =
  requiredElement<HTMLButtonElement>("#refresh-enabled-rules");
const ruleMatchForm =
  requiredElement<HTMLFormElement>("#rule-match-form");
const ruleMatchInput =
  requiredElement<HTMLInputElement>("#rule-match-input");
const ruleMatchResult =
  requiredElement<HTMLElement>("#rule-match-result");
const diagnosticList =
  requiredElement<HTMLElement>("#diagnostic-list");
const diagnosticStatus =
  requiredElement<HTMLElement>("#diagnostic-status");
const clearDiagnosticsButton =
  requiredElement<HTMLButtonElement>("#clear-diagnostics");
const rulesPanel =
  requiredElement<HTMLElement>('[data-tab-panel="rules"]');
const modeDescriptionElement =
  requiredElement<HTMLElement>("#mode-description");
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-ui-mode]"),
);
const presetControls = Array.from(
  document.querySelectorAll<HTMLInputElement>("[data-preset]"),
);
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-tab-target]"),
);
const tabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-tab-panel]"),
);
let renderedRulePackSettings: RulePackSetting[] = [];
let currentUiMode: "simple" | "expert" = "simple";

const PRESETS = {
  pinterest: {
    name: "Pinterest",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/pinterest.yaml",
  },
  github: {
    name: "GitHub",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml",
  },
} as const;

versionElement.textContent = chrome.runtime.getManifest().version;

function validateHost(host: string): boolean {
  if (host.length === 0) {
    return false;
  }

  if (host.includes("://") || host.includes("/")) {
    return false;
  }

  return true;
}

function getSelectedRulePackIds(): string[] {
  return Array.from(
    rulePackListElement.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    ),
  ).map((input) => input.value);
}

function updateRulePackCount(enabledIds: readonly string[]): void {
  const total = rulePackListElement.querySelectorAll(".rule-pack-card").length;
  rulePackCountElement.textContent =
    `${enabledIds.length}/${total} 已启用`;
}

async function saveRulePackSelection(): Promise<void> {
  const enabledIds = getSelectedRulePackIds();
  const response = (await chrome.runtime.sendMessage({
    type: "UPDATE_RULE_PACKS",
    enabledPackIds: enabledIds,
  })) as {
    ok: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "规则应用失败");
  }

  updateRulePackCount(enabledIds);
  rulePackStatusElement.textContent =
    response.message ?? "规则已保存";
}

async function saveRulePackOrder(reordered: RulePackSetting[]): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "REORDER_RULE_PACKS",
    orderedIds: reordered.map((pack) => pack.id).filter(Boolean),
  }) as { ok: boolean; message?: string; error?: string };

  if (!response.ok) {
    throw new Error(response.error ?? "优先级调整失败");
  }

  renderRulePacks(reordered);
  rulePackStatusElement.textContent = response.message ?? "规则优先级已更新";
}

function activateTab(tabId: string): void {
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== tabId;
  }
}

function applyUiMode(mode: "simple" | "expert"): void {
  currentUiMode = mode;
  rulesPanel.dataset.uiCurrent = mode;
  modeDescriptionElement.textContent = mode === "simple"
    ? "选择常用网站并开启即可，其余设置使用推荐值。"
    : "可以自定义订阅、连接方式、规则内容和优先级。";
  for (const button of modeButtons) {
    button.classList.toggle("active", button.dataset.uiMode === mode);
  }
}

function findPresetRule(
  presetId: keyof typeof PRESETS,
  settings: readonly RulePackSetting[] = renderedRulePackSettings,
): RulePackSetting | undefined {
  const preset = PRESETS[presetId];
  return settings.find(
    (pack) => pack.defaultUrl === preset.url || pack.source.url === preset.url,
  );
}

function syncPresetControls(settings: readonly RulePackSetting[]): void {
  for (const control of presetControls) {
    const presetId = control.dataset.preset as keyof typeof PRESETS;
    control.checked = findPresetRule(presetId, settings)?.enabled === true;
  }
}

async function setPresetEnabled(
  presetId: keyof typeof PRESETS,
  enabled: boolean,
): Promise<void> {
  const preset = PRESETS[presetId];
  const existing = findPresetRule(presetId);
  let packId = existing?.id;

  if (enabled && !packId) {
    const saved = await chrome.runtime.sendMessage({
      type: "SAVE_RULE_PACK",
      name: preset.name,
      url: preset.url,
      action: "PROXY",
      customContent: "",
    }) as { ok: boolean; data?: { packId: string }; error?: string };

    if (!saved.ok || !saved.data?.packId) {
      throw new Error(saved.error ?? `${preset.name} 添加失败`);
    }
    packId = saved.data.packId;
  }

  const currentEnabledIds = renderedRulePackSettings
    .filter((pack) => pack.enabled)
    .map((pack) => pack.id);
  const enabledIds = enabled && packId
    ? [...new Set([...currentEnabledIds, packId])]
    : currentEnabledIds.filter((id) => id !== packId);
  const response = await chrome.runtime.sendMessage({
    type: "UPDATE_RULE_PACKS",
    enabledPackIds: enabledIds,
  }) as { ok: boolean; error?: string };

  if (!response.ok) {
    throw new Error(response.error ?? `${preset.name} 启用失败`);
  }

  await loadStoredData();
  rulePackStatusElement.textContent =
    `${preset.name} 已${enabled ? "开启" : "关闭"}`;
}

interface DiagnosticEvent {
  type: "proxy" | "subscription" | "background";
  message: string;
  details?: string;
  occurredAt: string;
}

async function loadDiagnostics(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "GET_DIAGNOSTIC_EVENTS",
  }) as { ok: boolean; data?: DiagnosticEvent[]; error?: string };

  if (!response.ok) {
    throw new Error(response.error ?? "诊断记录读取失败");
  }

  const events = response.data ?? [];

  if (events.length === 0) {
    diagnosticList.textContent = "暂无诊断记录";
    return;
  }

  const fragment = document.createDocumentFragment();
  const typeLabels = {
    proxy: "代理",
    subscription: "订阅",
    background: "后台",
  };

  for (const item of events) {
    const row = document.createElement("article");
    const title = document.createElement("strong");
    const time = document.createElement("time");
    const details = document.createElement("small");
    title.textContent = `[${typeLabels[item.type]}] ${item.message}`;
    time.dateTime = item.occurredAt;
    time.textContent = new Date(item.occurredAt).toLocaleString("zh-CN");
    details.textContent = item.details || "无更多信息";
    row.append(title, time, details);
    fragment.append(row);
  }

  diagnosticList.replaceChildren(fragment);
}

const FALLBACK_DESCRIPTIONS: Record<FallbackMode, string> = {
  direct: "未命中规则的网站由 Chrome 直接连接。",
  proxy: "未命中规则的网站全部使用当前局域网 HTTP 代理。",
  system: "交还 Chrome 系统代理模式；自定义规则分流会暂停。",
};

async function saveFallbackMode(): Promise<void> {
  const fallbackMode = fallbackModeElement.value as FallbackMode;
  fallbackDescriptionElement.textContent =
    FALLBACK_DESCRIPTIONS[fallbackMode];

  const response = (await chrome.runtime.sendMessage({
    type: "UPDATE_FALLBACK_MODE",
    fallbackMode,
  })) as {
    ok: boolean;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? "兜底策略保存失败");
  }

  fallbackStatusElement.textContent =
    response.message ?? "兜底策略已保存";
}

async function requestUrlPermission(url: string): Promise<void> {
  if (!url.trim()) {
    return;
  }

  const parsed = new URL(url);

  if (parsed.hostname === "raw.githubusercontent.com") {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: [`${parsed.origin}/*`],
  });

  if (!granted) {
    throw new Error("未授予该订阅地址的访问权限");
  }
}

function renderRulePacks(settings: readonly RulePackSetting[]): void {
  renderedRulePackSettings = [...settings];
  syncPresetControls(settings);
  const fragment = document.createDocumentFragment();

  for (const pack of settings) {
    const card = document.createElement("article");
    card.className = "rule-pack-card";
    card.dataset.packId = pack.id;
    card.draggable = Boolean(pack.id) && currentUiMode === "expert";

    card.addEventListener("dragstart", (event) => {
      if (!pack.id || !event.dataTransfer) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", pack.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (event) => {
      if (pack.id) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      }
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer?.getData("text/plain");
      const fromIndex = settings.findIndex((item) => item.id === draggedId);
      const toIndex = settings.findIndex((item) => item.id === pack.id);

      if (!draggedId || fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return;
      }

      const reordered = [...settings];
      const [dragged] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, dragged);
      void saveRulePackOrder(reordered).catch((error: unknown) => {
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "优先级调整失败";
      });
    });

    const header = document.createElement("div");
    header.className = "rule-pack-item";

    const copy = document.createElement("span");
    copy.className = "rule-pack-copy";

    const nameInput = document.createElement("input");
    nameInput.className = "rule-name-input";
    nameInput.value = pack.name;
    nameInput.placeholder = "规则名称";

    const description = document.createElement("small");
    description.textContent = pack.validation
      ? `${pack.validation.effective} 条有效规则` +
        (pack.validation.ignored > 0 ? `，忽略 ${pack.validation.ignored} 条` : "")
      : pack.description;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = pack.id;
    checkbox.checked = pack.enabled;
    checkbox.disabled = !pack.id;
    checkbox.addEventListener("change", () => {
      void saveRulePackSelection().catch((error: unknown) => {
        console.error(error);
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "规则保存失败";
      });
    });

    const dragHandle = document.createElement("span");
    dragHandle.className = "rule-drag-handle";
    dragHandle.textContent = "⠿";
    dragHandle.title = "拖动调整优先级";
    copy.append(nameInput, description);
    header.append(dragHandle, copy, checkbox);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "订阅与编辑";

    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.value = pack.source.url || pack.defaultUrl;
    urlInput.placeholder = "规则订阅 URL";

    const actionSelect = document.createElement("select");
    actionSelect.innerHTML = [
      '<option value="PROXY">局域网代理</option>',
      '<option value="DIRECT">本地直连</option>',
    ].join("");
    actionSelect.value = pack.defaultAction;

    const editor = document.createElement("textarea");
    editor.value = pack.source.customContent || pack.source.cachedContent || "";
    editor.placeholder = "可选：粘贴或编辑 YAML/规则文本；留空则使用远程订阅";

    const meta = document.createElement("small");
    meta.textContent = pack.source.status === "cached" && pack.source.error
      ? `更新失败，正在使用缓存：${pack.source.error}`
      : pack.source.error
        ? `下载错误：${pack.source.error}`
      : pack.source.updatedAt
        ? `最近更新：${new Date(pack.source.updatedAt).toLocaleString("zh-CN")}`
        : "尚未下载";

    const actions = document.createElement("div");
    actions.className = "rule-pack-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "保存来源";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "立即下载";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "删除";

    saveButton.addEventListener("click", () => {
      void (async () => {
        await requestUrlPermission(urlInput.value);
        const response = await chrome.runtime.sendMessage({
          type: "SAVE_RULE_PACK",
          packId: pack.id || undefined,
          name: nameInput.value,
          url: urlInput.value,
          action: actionSelect.value,
          customContent: editor.value,
        }) as {
          ok: boolean;
          data?: { packId: string };
          message?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(response.error ?? "保存失败");
        }

        if (response.data?.packId) {
          pack.id = response.data.packId;
          checkbox.value = pack.id;
          checkbox.disabled = false;
        }

        pack.name = nameInput.value.trim();

        rulePackStatusElement.textContent = response.message ?? "保存成功";
        await loadStoredData();
      })().catch((error: unknown) => {
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "保存失败";
      });
    });

    refreshButton.addEventListener("click", () => {
      void (async () => {
        await requestUrlPermission(urlInput.value);
        const response = await chrome.runtime.sendMessage({
          type: "REFRESH_RULE_PACK",
          packId: pack.id,
        }) as { ok: boolean; message?: string; error?: string };

        if (!response.ok) {
          throw new Error(response.error ?? "下载失败");
        }

        rulePackStatusElement.textContent = response.message ?? "下载成功";
        await loadStoredData();
      })().catch((error: unknown) => {
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "下载失败";
      });
    });

    deleteButton.addEventListener("click", () => {
      if (!pack.id) {
        card.remove();
        return;
      }

      void (async () => {
        const response = await chrome.runtime.sendMessage({
          type: "DELETE_RULE_PACK",
          packId: pack.id,
        }) as { ok: boolean; message?: string; error?: string };

        if (!response.ok) {
          throw new Error(response.error ?? "删除失败");
        }

        await loadStoredData();
        rulePackStatusElement.textContent = response.message ?? "规则已删除";
      })().catch((error: unknown) => {
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "删除失败";
      });
    });

    actions.append(saveButton, refreshButton, deleteButton);
    details.append(summary, urlInput, actionSelect, editor, meta, actions);
    card.append(header, details);
    fragment.append(card);
  }

  rulePackListElement.replaceChildren(fragment);
  updateRulePackCount(settings.filter((pack) => pack.enabled).map((pack) => pack.id));
}

async function loadStoredData(): Promise<void> {
  const [result, rulePackResponse] = await Promise.all([
    chrome.storage.local.get([
      INSTALL_TIME_KEY,
      PROXY_CONFIG_KEY,
      ENABLED_RULE_PACK_IDS_KEY,
      FALLBACK_MODE_KEY,
      UI_MODE_KEY,
    ]),
    chrome.runtime.sendMessage({ type: "GET_RULE_PACK_SETTINGS" }) as Promise<{
      ok: boolean;
      data?: RulePackSetting[];
      error?: string;
    }>,
  ]);

  const installedAt = result[INSTALL_TIME_KEY] as string | undefined;
  const proxyConfig = result[PROXY_CONFIG_KEY] as ProxyConfig | undefined;
  const storedEnabledIds = result[ENABLED_RULE_PACK_IDS_KEY] as unknown;
  const enabledIds = Array.isArray(storedEnabledIds)
    ? storedEnabledIds.filter((id): id is string => typeof id === "string")
    : [...DEFAULT_ENABLED_RULE_PACK_IDS];
  const storedFallbackMode = result[FALLBACK_MODE_KEY] as unknown;
  const storedUiMode = result[UI_MODE_KEY] as unknown;
  applyUiMode(storedUiMode === "expert" ? "expert" : "simple");
  const fallbackMode: FallbackMode =
    storedFallbackMode === "proxy" || storedFallbackMode === "system"
      ? storedFallbackMode
      : "direct";

  renderRulePacks(rulePackResponse.ok && rulePackResponse.data
    ? rulePackResponse.data
    : DEFAULT_RULE_PACKS.map((pack) => ({
        ...pack,
        enabled: enabledIds.includes(pack.id),
        source: {},
      })));
  fallbackModeElement.value = fallbackMode;
  fallbackDescriptionElement.textContent =
    FALLBACK_DESCRIPTIONS[fallbackMode];

  installedAtElement.textContent = installedAt
    ? new Date(installedAt).toLocaleString("zh-CN")
    : "暂无记录";

  if (!proxyConfig) {
    statusElement.textContent = "尚未保存代理配置";
    return;
  }

  hostInput.value = proxyConfig.host;
  portInput.value = String(proxyConfig.port);

  statusElement.textContent =
    `已读取配置：http://${proxyConfig.host}:${proxyConfig.port}`;
}

async function saveProxyConfig(): Promise<void> {
  const host = hostInput.value.trim();
  const port = Number(portInput.value);

  if (!validateHost(host)) {
    statusElement.textContent =
      "代理地址只填写主机名或 IP，例如 127.0.0.1。";
    return;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    statusElement.textContent =
      "端口必须是 1 到 65535 之间的整数。";
    return;
  }

  const proxyConfig: ProxyConfig = {
    type: "http",
    host,
    port,
  };

  await chrome.storage.local.set({
    [PROXY_CONFIG_KEY]: proxyConfig,
  });

  statusElement.textContent =
    `保存成功：http://${host}:${port}`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  void saveProxyConfig().catch((error: unknown) => {
    console.error(error);

    statusElement.textContent =
      error instanceof Error ? error.message : "保存失败";
  });
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tabTarget;

    if (target) {
      activateTab(target);
      if (target === "about") {
        void loadDiagnostics().catch((error: unknown) => {
          diagnosticStatus.textContent =
            error instanceof Error ? error.message : "诊断记录读取失败";
        });
      }
    }
  });
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.uiMode === "expert" ? "expert" : "simple";
    applyUiMode(mode);
    renderRulePacks(renderedRulePackSettings);
    void chrome.storage.local.set({ [UI_MODE_KEY]: mode });
  });
}

for (const control of presetControls) {
  control.addEventListener("change", () => {
    const presetId = control.dataset.preset as keyof typeof PRESETS;
    const enabled = control.checked;
    control.disabled = true;
    rulePackStatusElement.textContent =
      `正在${enabled ? "开启" : "关闭"} ${PRESETS[presetId].name}…`;
    void setPresetEnabled(presetId, enabled)
      .catch((error: unknown) => {
        control.checked = !enabled;
        rulePackStatusElement.textContent =
          error instanceof Error ? error.message : "预设操作失败";
      })
      .finally(() => {
        control.disabled = false;
      });
  });
}

fallbackModeElement.addEventListener("change", () => {
  void saveFallbackMode().catch((error: unknown) => {
    console.error(error);
    fallbackStatusElement.textContent =
      error instanceof Error ? error.message : "兜底策略保存失败";
  });
});

clearDiagnosticsButton.addEventListener("click", () => {
  clearDiagnosticsButton.disabled = true;
  void chrome.runtime.sendMessage({ type: "CLEAR_DIAGNOSTIC_EVENTS" })
    .then(async (response: { ok: boolean; message?: string; error?: string }) => {
      if (!response.ok) {
        throw new Error(response.error ?? "清除失败");
      }
      await loadDiagnostics();
      diagnosticStatus.textContent = response.message ?? "诊断记录已清除";
    })
    .catch((error: unknown) => {
      diagnosticStatus.textContent =
        error instanceof Error ? error.message : "清除失败";
    })
    .finally(() => {
      clearDiagnosticsButton.disabled = false;
    });
});

addRulePackButton.addEventListener("click", () => {
  renderRulePacks([
    ...renderedRulePackSettings,
    {
      id: "",
      name: "",
      description: "自定义远程规则",
      defaultUrl: "",
      defaultAction: "PROXY",
      enabled: false,
      source: {},
    },
  ]);
});

refreshEnabledRulesButton.addEventListener("click", () => {
  refreshEnabledRulesButton.disabled = true;
  rulePackStatusElement.textContent = "正在更新已启用的远程规则…";

  void chrome.runtime.sendMessage({
    type: "REFRESH_ENABLED_RULE_PACKS",
  }).then(async (response: { ok: boolean; message?: string; error?: string }) => {
    if (!response.ok) {
      throw new Error(response.error ?? "批量更新失败");
    }

    await loadStoredData();
    rulePackStatusElement.textContent = response.message ?? "规则更新完成";
  }).catch((error: unknown) => {
    rulePackStatusElement.textContent =
      error instanceof Error ? error.message : "批量更新失败";
  }).finally(() => {
    refreshEnabledRulesButton.disabled = false;
  });
});

ruleMatchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ruleMatchResult.textContent = "正在匹配…";

  void chrome.runtime.sendMessage({
    type: "TEST_RULE_MATCH",
    input: ruleMatchInput.value,
  }).then((response: {
    ok: boolean;
    data?: {
      hostname: string;
      action: "DIRECT" | "PROXY" | "SYSTEM";
      matched: boolean;
      rule?: { type: string; value: string };
    };
    error?: string;
  }) => {
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "规则匹配失败");
    }

    const actionLabel = {
      DIRECT: "本地直连",
      PROXY: "局域网代理",
      SYSTEM: "系统代理",
    }[response.data.action];
    ruleMatchResult.textContent = response.data.matched && response.data.rule
      ? `${response.data.hostname} → ${actionLabel}；命中 ${response.data.rule.type},${response.data.rule.value}`
      : `${response.data.hostname} → ${actionLabel}；未命中规则，使用兜底策略`;
  }).catch((error: unknown) => {
    ruleMatchResult.textContent =
      error instanceof Error ? error.message : "规则匹配失败";
  });
});

void loadStoredData().catch((error: unknown) => {
  console.error(error);

  statusElement.textContent =
    error instanceof Error ? error.message : "读取配置失败";
});
