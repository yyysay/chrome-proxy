# Auto Proxy V14

V14 继续收敛产品边界：普通用户只负责“开启 / 关闭”，高级设置才暴露代理来源、未命中策略和自定义规则。

## 页面结构

### 首次安装：`onboarding.html`

首次安装只打开欢迎页，不再把高级设置当成初始页面。

流程：

1. 点击“开启 Auto Proxy”，自动使用默认代理来源和 Managed Rules。
2. 开启成功后关闭欢迎页。
3. 以后日常只使用工具栏 Popup 的 ON / OFF。
4. 只有需要改订阅、手动代理、未命中策略或自定义规则时才进入“高级设置”。

Chrome 扩展选项页已经改为 `settings.html`。

### Popup

Popup 保持普通用户入口：

- 开启 / 关闭代理。
- 当前代理。
- 最近一次缓存的代理出口健康结果。
- 高级设置入口。

不会因为打开 Popup 自动做 IP 检测。

## 代理来源

高级设置提供两种来源：

- **代理订阅**：默认来源。
- **手动覆盖**：仅覆盖当前设备。

V13 第一次选择“手动覆盖”时会出现“请先手动保存代理地址”，但保存入口又处于隐藏状态。V14 已修复：

1. 第一次点击“手动覆盖”直接展开地址 / 端口表单。
2. 不立即切换运行来源。
3. 点击“保存手动代理”时同时完成保存和启用手动覆盖。

### 代理订阅

实现：`src/proxy/proxy-provider.ts`

发布版默认订阅地址仍集中在：

```ts
export const DEFAULT_PROXY_SUBSCRIPTION_URL = "";
```

填入正式 URL 后，记得把固定 origin 加入 `public/manifest.json` 的 `host_permissions`。

订阅协议仍保留：

```json
{
  "version": 1,
  "proxies": [
    {
      "id": "default",
      "name": "Default Proxy",
      "type": "http",
      "host": "127.0.0.1",
      "port": 7890
    }
  ]
}
```

V14 **不提供多节点选择 UI**，也不保存 activeProxyId。即使 `proxies` 里有多个节点，当前固定使用第一个有效节点。

保留数组结构只是为了未来真正实现“规则选择出口”时无需迁移订阅 schema。

订阅失败时继续使用 last-known-good；没有可用订阅时使用内置 `127.0.0.1:7890` 兜底。

## 未命中规则

高级设置重新提供三种策略：

- **直接连接**：未命中规则 → `DIRECT`。
- **当前代理**：未命中规则 → 当前有效代理。
- **系统代理**：交还 Chrome / 操作系统代理，同时暂停 Auto Proxy 的 PAC 规则分流。

注意：PAC 没有标准的“继续走系统代理”返回值，因此“系统代理”不是一条 PAC fallback，而是主动清除扩展控制的代理设置。

## Managed Rules

默认 Managed Rules 仍由产品维护，例如 Pinterest / GitHub。

编译优先级：

```text
Custom Rules
    ↓
Managed Rules
    ↓
未命中策略
```

Custom Rules 在 catalog 中排在 Managed Rules 前面，compiler 使用 first-rule-wins，因此用户自定义规则可以覆盖默认规则。

### 默认规则订阅强制走当前代理

Managed Rules 的远程来源不能依赖“当前已经存在的分流规则”，否则会产生循环依赖。

V14 的处理：

1. 正常 Auto Proxy PAC 会把所有 Managed Rule Source host 作为基础设施域名，优先发送到当前代理。
2. 即使用户写了同域名 DIRECT 规则，Managed Rule Source 的基础设施路由仍优先。
3. 如果扩展当前关闭、处于系统代理模式，或正常 PAC 不可用，刷新 Managed Rules 时会临时安装一个只代理对应规则源 host 的 PAC。
4. 下载完成后立即恢复用户原来的 Chrome 代理状态。
5. 网络出口检测与上述临时 PAC 操作共享同一个队列，避免两个后台任务互相覆盖代理设置。

Custom Rule 的自定义订阅不强制走代理；只有产品维护的 Managed Rules 采用基础设施代理路径。

## 网络健康

健康定义保持不变：

```text
DIRECT IP 和 PROXY IP 都存在，并且 DIRECT IP != PROXY IP
→ 健康

其他
→ 异常
```

地理国家不参与健康判断。

网络检测结果继续绑定当前 `host + port` 并保存最后检测时间：

- 普通刷新 / 重开页面：读取缓存，不自动检测。
- 有效代理 endpoint 改变：旧缓存失效并自动检测。
- 用户点击“刷新”：重新检测。

## 存储迁移

V14 schemaVersion 为 `5`。

迁移继续清理旧模式状态：

- `simpleEnabledRulePackIds`
- `uiMode`
- 旧 `ruleSourceStrategies`
- 旧 `activeProxyId`

`fallbackMode` 在 V14 重新成为有效状态，不会被清除。

## 检查

已完成：

- `node --experimental-strip-types --test tests/*.test.ts`：**15 / 15 通过**。
- 新增 Managed Rule Source 强制代理顺序测试。
- TypeScript 严格检查（本地 Chrome API stub）：通过。
- `settings.html`：58 / 58 必需 DOM selector 存在。
- `onboarding.html`：6 / 6 必需 DOM selector 存在。
- `popup.html`：10 / 10 必需 DOM selector 存在。

当前执行环境没有 Vite / `@types/chrome` 安装源，因此没有伪造真实 `vite build` 结果。

在开发机执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

然后在 `chrome://extensions` 重新加载 `dist/`。
