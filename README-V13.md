# Auto Proxy V13 架构版

V13 将原来的“简易模式 / 高级模式”收敛成一个更明确的产品模型：

- Popup：普通用户入口，只保留代理 ON / OFF、当前节点和最近一次出口健康结果。
- Settings：高级设置中心，负责代理订阅、手动覆盖、网络出口、自定义规则和诊断。
- Managed Rules：产品默认规则，永远启用，不提供单独开关。
- Custom Rules：用户规则，优先于 Managed Rules。
- PAC 未命中：永远 DIRECT。

## 代理来源

运行时代理优先级由设置来源决定：

1. `manual`：当前设备手动覆盖。
2. `subscription`：代理订阅中的当前节点。
3. 订阅模式没有可用节点时：内置 `127.0.0.1:7890` fallback。

代理订阅实现位于：

`src/proxy/proxy-provider.ts`

要在发布版里预置统一订阅地址，只需要修改：

```ts
export const DEFAULT_PROXY_SUBSCRIPTION_URL = "https://your-domain.example/proxies.json";
```

注意：如果把 URL 写死为默认订阅，建议同时把对应域名加入 `public/manifest.json` 的 `host_permissions`，避免首次运行还需要用户授权。

如果订阅地址由设置页填写，设置页会通过 `optional_host_permissions` 请求对应 origin 权限。

## 代理订阅 JSON v1

示例见：`examples/proxy-subscription.json`

```json
{
  "version": 1,
  "updatedAt": "2026-08-07T15:30:00+08:00",
  "proxies": [
    {
      "id": "jp-main",
      "name": "Japan",
      "type": "http",
      "host": "192.168.1.10",
      "port": 7890
    },
    {
      "id": "office",
      "name": "Office",
      "type": "http",
      "host": "192.168.1.20",
      "port": 7890
    }
  ]
}
```

字段约束：

- `version`：目前固定 `1`。
- `proxies`：至少一个节点。
- `id`：订阅内唯一。
- `name`：显示名称。
- `type`：目前只支持 `http`。
- `host`：主机名或 IP，不带协议和路径。
- `port`：1-65535。

订阅成功后会保存 last-known-good。相同订阅 URL 临时更新失败时继续使用缓存。订阅默认每 6 小时后台检查一次；如果当前节点 endpoint 发生变化且代理处于开启状态，会自动重建 PAC。

## 网络健康

健康定义保持 V12 确认的严格模型：

- DIRECT IP 与 PROXY IP 都获取成功，且不同：`健康`。
- 其他任何情况：`异常`。

国家/地区不参与健康判定。CN 代理出口只要与本地直连 IP 不同，同样属于健康。

网络检测不会在普通刷新/重开设置页时自动执行。以下情况会执行：

- 当前有效代理 host / port 发生变化。
- 用户手动点击网络信息“刷新”。

检测结果缓存绑定当前 `host + port`，并显示最后检测时间。

## Managed Rules

V13 当前内置：

- Pinterest
- GitHub

远程规则来源仍为 MetaCubeX；`catalog.ts` 同时保留最小内置 fallback，所以远程订阅暂时失败不会导致默认规则完全消失。

规则编译顺序：

```text
Custom Rules
    ↓
Managed Rules
    ↓
DIRECT
```

`compiler.ts` 使用 first-rule-wins，因此 Custom Rules 可以自然覆盖同一域名的 Managed Rule。

## 存储迁移

Schema 升级到 `4`。

迁移会：

- 清理运行时不再使用的 `simpleEnabledRulePackIds`。
- 清理 `uiMode`。
- 清理 `fallbackMode`。
- 将旧 `proxyConfig` 迁移为手动代理候选。
- 旧配置如果不是默认 `127.0.0.1:7890`，且没有代理订阅，会保留为 manual source，避免升级后突然更换 endpoint。
- 以前由“简易模式”动态创建的 Pinterest / GitHub 重复自定义定义会移除，由 Managed Rules 接管。

## 检查结果

当前工作环境无法从内部 npm registry 安装 `@types/chrome` / Vite，因此没有执行真实 `pnpm build`。

已完成：

- TypeScript 严格语法/类型检查（使用本地 Chrome API stub）：通过。
- `node --experimental-strip-types --test tests/*.test.ts`：14/14 通过。
- onboarding 必需 DOM selector：58/58 存在。
- popup 必需 DOM selector：10/10 存在。

在你的开发机覆盖后执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

然后在 `chrome://extensions` 重新加载 `dist/`。
