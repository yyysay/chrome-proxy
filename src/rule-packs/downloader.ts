import type { RulePackDefinition } from "./types.ts";
import {
  isManagedDefinition,
  loadRulePackDefinitions,
  loadRulePackSources,
  normalizeRuleSourceStrategy,
  saveRulePackSources,
} from "./repository.ts";
import { applySelectedMode } from "../proxy/pac-controller.ts";
import { getEffectiveProxy } from "../proxy/proxy-provider.ts";
import {
  assertControllable,
  getDesiredEnabled,
  loadFallbackMode,
  readEffectiveSetting,
  runExclusiveProxyMutation,
  toProxyConfig,
} from "../proxy/proxy-state.ts";

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

async function downloadRuleSourceText(pack: RulePackDefinition, url: string): Promise<string> {
  const download = async (): Promise<string> => {
    let temporaryProxyApplied = false;

    if (isManagedDefinition(pack)) {
      const [desiredEnabled, fallbackMode, effective] = await Promise.all([
        getDesiredEnabled(),
        loadFallbackMode(),
        readEffectiveSetting(),
      ]);
      const regularPacCanRouteSource = desiredEnabled && fallbackMode !== "system" &&
        effective.mode === "pac_script" && effective.levelOfControl === "controlled_by_this_extension";

      if (!regularPacCanRouteSource) {
        const parsed = new URL(url);
        const config = toProxyConfig(await getEffectiveProxy());
        assertControllable(effective.levelOfControl);
        const host = JSON.stringify(parsed.hostname.toLowerCase());
        const suffix = JSON.stringify(`.${parsed.hostname.toLowerCase()}`);
        const proxyResult = JSON.stringify(`PROXY ${config.host}:${config.port}`);
        const temporaryPac: chrome.proxy.ProxyConfig = {
          mode: "pac_script",
          pacScript: {
            mandatory: true,
            data: [
              "function FindProxyForURL(url, host) {",
              "  host = host.toLowerCase();",
              `  if (host === ${host} || dnsDomainIs(host, ${suffix})) return ${proxyResult};`,
              '  return "DIRECT";',
              "}",
            ].join("\n"),
          },
        };
        await chrome.proxy.settings.set({ value: temporaryPac, scope: "regular" });
        temporaryProxyApplied = true;
      }
    }

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new Error("订阅文件超过 2 MB 限制");
      }
      const content = await response.text();
      if (new TextEncoder().encode(content).byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error("订阅文件超过 2 MB 限制");
      }
      return content;
    } finally {
      if (temporaryProxyApplied) {
        if (await getDesiredEnabled()) await applySelectedMode();
        else await chrome.proxy.settings.clear({ scope: "regular" });
      }
    }
  };

  return isManagedDefinition(pack)
    ? runExclusiveProxyMutation(download)
    : download();
}

export async function refreshRulePackSource(packId: string): Promise<void> {
  const definitions = await loadRulePackDefinitions();
  const pack = definitions.find((item) => item.id === packId);
  if (!pack) throw new Error(`未知规则：${packId}`);

  const sources = await loadRulePackSources();
  const current = sources[packId] ?? {};
  const url = current.url || pack.defaultUrl;
  const lastAttemptAt = new Date().toISOString();
  if (!url) throw new Error(`${pack.name} 没有远程订阅地址`);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${pack.name} 的订阅地址无效`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`${pack.name} 仅支持 HTTP/HTTPS 订阅`);
  }

  sources[packId] = {
    ...current,
    url,
    lastAttemptAt,
    status: "downloading",
    error: undefined,
  };
  await saveRulePackSources(sources);

  try {
    const content = await downloadRuleSourceText(pack, url);
    sources[packId] = {
      ...current,
      url,
      cachedContent: content,
      updatedAt: new Date().toISOString(),
      lastAttemptAt,
      status: "ready",
      error: undefined,
    };
    await saveRulePackSources(sources);
  } catch (error) {
    const sourceStrategy = normalizeRuleSourceStrategy(current.sourceStrategy);
    const hasSelectedContent = Boolean(
      current.cachedContent ||
      (pack.kind === "builtin" && pack.rulesText) ||
      (sourceStrategy === "merge" && current.customContent),
    );
    sources[packId] = {
      ...current,
      url,
      lastAttemptAt,
      status: hasSelectedContent ? "cached" : "error",
      error: error instanceof Error ? error.message : "下载失败",
    };
    await saveRulePackSources(sources);
    if (!hasSelectedContent) {
      throw new Error(`${pack.name} 规则下载失败：${sources[packId].error}`);
    }
  }
}
