import {
  applyConfigDocument,
  getConfigProviderContent,
  getConfigDocumentState,
  getSiteProxyStatus,
  refreshConfigProviders,
  testConfigRuleMatch,
} from "../config/config-service.ts";
import { disableProxy, enableProxy, getProxyStatus } from "../proxy/pac-controller.ts";
import type { RuntimeMessage, RuntimeResponse } from "../shared/runtime-protocol.ts";
import { getActiveTabActionState, syncActionState } from "./action-state.ts";
import { clearDiagnosticEvents, getDiagnosticEvents } from "./diagnostics.ts";
import { inspectNetworkInfo } from "./network-inspector.ts";
import { clearTabRequestRouteStates, getActiveTabRequestRoutes } from "./request-route-state.ts";

export async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  switch (message.type) {
    case "ENABLE_PROXY": {
      const config = await enableProxy();
      await clearTabRequestRouteStates();
      await syncActionState();
      return { ok: true, message: `代理已启用：http://${config.host}:${config.port}` };
    }
    case "DISABLE_PROXY":
      await disableProxy();
      await clearTabRequestRouteStates();
      await syncActionState();
      return { ok: true, message: "扩展代理设置已关闭" };
    case "GET_PROXY_STATUS":
      return { ok: true, data: await getProxyStatus() };
    case "GET_CONFIG_DOCUMENT_STATE":
      return { ok: true, data: await getConfigDocumentState() };
    case "GET_SITE_PROXY_STATUS":
      return { ok: true, data: await getSiteProxyStatus(message.input) };
    case "GET_ACTIVE_SITE_PROXY_STATUS":
      return { ok: true, data: await getActiveTabActionState() };
    case "GET_ACTIVE_TAB_REQUEST_ROUTES":
      return { ok: true, data: await getActiveTabRequestRoutes() };
    case "GET_CONFIG_PROVIDER_CONTENT":
      return { ok: true, data: await getConfigProviderContent(message.name) };
    case "APPLY_CONFIG_DOCUMENT": {
      const result = await applyConfigDocument(message.yaml, message.sourceUrl, message.refreshIntervalSeconds);
      await clearTabRequestRouteStates();
      await syncActionState();
      return { ok: true, data: result, message: result.pacReapplied ? "配置已保存，PAC 已重新生成" : "配置已保存；开启扩展后生效" };
    }
    case "REFRESH_CONFIG_PROVIDERS": {
      const result = await refreshConfigProviders();
      await clearTabRequestRouteStates();
      await syncActionState();
      return { ok: true, data: result, message: `规则包更新完成：成功 ${result.refreshed}，缓存 ${result.cached}` };
    }
    case "GET_NETWORK_INFO":
      return { ok: true, ...(await inspectNetworkInfo(message.nodeName)) };
    case "TEST_RULE_MATCH":
      return { ok: true, data: await testConfigRuleMatch(message.input) };
    case "GET_DIAGNOSTIC_EVENTS":
      return { ok: true, data: await getDiagnosticEvents() };
    case "CLEAR_DIAGNOSTIC_EVENTS":
      await clearDiagnosticEvents();
      return { ok: true, message: "诊断记录已清除" };
    default:
      return { ok: false, error: "未知消息类型" };
  }
}
