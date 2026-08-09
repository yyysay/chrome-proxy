# Auto Proxy · v0.2.1 项目上下文

更新日期：2026-08-09

这是一款基于 Chrome Manifest V3、`chrome.proxy` 与 PAC 的轻量规则分流扩展。本文用于新聊天快速恢复项目上下文；日常安装与开发命令仍以 `README.md` 为准。

## 当前功能

- 首次设置：填写代理订阅、检测代理出口、开启扩展，并提示固定到 Chrome 工具栏。
- 代理来源：支持远程代理订阅或手动填写 HTTP 代理地址与端口。
- 代理控制：Popup 一键开启/关闭；期望状态持久化，后台会在 Chrome 丢失 PAC 后自动恢复。
- 网络检测：比较本地直连出口与代理出口的 IP、位置和运营商信息。
- 规则管理：默认规则、自定义规则和隐藏的内置规则统一编译；支持启用、编辑、折叠、单条更新和批量更新。
- 规则诊断：支持域名命中测试、重复/冲突统计、PAC 大小统计及后台诊断记录。
- 自动更新：代理订阅和已启用规则均支持分钟、小时、天等自定义周期。
- 界面：Onboarding、Popup、设置页均适配 Tailwind CSS `dark:` 深色模式。

## 核心实现链路

```text
Popup / Onboarding / Settings
  → chrome.runtime.sendMessage
  → background/message-handler.ts
  → proxy 或 rule-packs 服务
  → 生成 PAC
  → chrome.proxy.settings
```

扩展开启状态记录在 `chrome.storage.local`。当页面刷新、打开新标签页或扩展重新加载时，后台通过 `reconcile-scheduler.ts` 检查并恢复应生效的 PAC；关闭扩展后才释放控制。

## 代理逻辑

- 代理订阅格式为 JSON：`version: 1`，包含 `proxies[]`；当前自动使用第一个有效 HTTP 节点。
- 手动代理支持 `host + port`，目前仅支持 HTTP 代理。
- 未配置有效订阅或手动代理时，运行时保留 `127.0.0.1:7890` 作为内部兜底节点，但初次设置页不再预填代理订阅 URL。
- `MATCH` 有三种策略：
  - 直接连接：PAC 返回 `DIRECT`。
  - 当前代理：PAC 返回当前 HTTP 代理。
  - 系统代理：扩展释放 Chrome 代理控制，规则分流暂停。
- `DIRECT` 仅表示 Chrome 不使用扩展配置的 HTTP 代理，无法绕过系统级 VPN、TUN 或透明代理。

代理订阅示例：

```json
{
  "version": 1,
  "proxies": [
    {
      "id": "local",
      "name": "Local Proxy",
      "type": "http",
      "host": "127.0.0.1",
      "port": 7890
    }
  ]
}
```

## 规则逻辑

匹配顺序为：

```text
自定义规则 → 默认远程规则 → 内置规则 → MATCH
```

- 支持 `DOMAIN`、`DOMAIN-SUFFIX`、`DOMAIN-KEYWORD`、`IP-CIDR`（IPv4）。
- 规则从上到下匹配，首条命中即结束。
- 默认规则定义在 `src/rule-packs/catalog.ts`，默认可关闭、可覆盖配置，但不可删除。
- 内置规则随代码发布、始终启用并隐藏在普通 UI 中。
- 自定义规则可新增、修改和删除。
- 隐藏的“本地网络直连”内置规则覆盖 localhost、`.local`、回环、链路本地与常见 IPv4 私网；更靠前的自定义或默认规则可以覆盖它。
- 重复规则去重；连接策略冲突时保留排序更靠前的规则。
- 规则内容策略严格区分来源，不做隐式 fallback：
  - `subscription-first`：只使用远程内容。
  - `local-first`：只使用本地内容，本地允许为空。
  - `merge`：远程与本地合并后去重。
- 自动更新只处理已启用且需要远程内容的规则；失败时继续使用上次缓存，并在对应规则标题旁显示“更新失败”徽标。
- 默认规则首次缺少缓存时自动下载，依次尝试直连、系统代理、当前代理，共三次；完成后恢复此前的 Chrome 代理状态。

## 规则语法与数据溯源

- 规则语法兼容 Mihomo 常见 domain provider 写法，可直接使用兼容的远程 YAML 订阅。
- 默认 Pinterest 规则来自 MetaCubeX：`meta-rules-dat/meta/geo/geosite/pinterest.yaml`。
- 其他产品默认规则及 URL 统一维护在 `src/rule-packs/catalog.ts`。
- 网络出口检测使用 `myip.ipip.net` 获取国内直连出口，使用 `api.ip.sb/geoip` 获取代理出口。
- 浏览器能力来自 Chrome MV3 API：`chrome.proxy`、`chrome.storage`、`chrome.alarms`、`chrome.runtime` 与可选域名权限。

## 关键文件

| 位置 | 职责 |
| --- | --- |
| `public/manifest.json` | Chrome 扩展清单与正式版本号 |
| `src/background/service-worker.ts` | 后台入口、安装/启动恢复 |
| `src/background/message-handler.ts` | UI 与后台消息路由 |
| `src/proxy/pac-controller.ts` | PAC 应用、关闭和状态恢复 |
| `src/proxy/proxy-provider.ts` | 代理订阅、手动代理与节点选择 |
| `src/rule-packs/catalog.ts` | 默认规则和内置规则目录 |
| `src/rule-packs/downloader.ts` | 规则下载、三路径重试与缓存状态 |
| `src/rule-packs/repository.ts` | 规则定义、来源与存储读写 |
| `src/rule-packs/service.ts` | 规则增删改、启用、更新和命中测试 |
| `src/rule-packs/provider-parser.ts` | Mihomo/YAML 规则内容规范化 |
| `src/settings/*` | 高级设置各功能模块 |
| `src/shared/storage-keys.ts` | 持久化键名总表 |

## 开发与维护约定

- 开发使用 `pnpm dev`，不要为了日常调试额外执行 `build`。
- 提交前运行：`pnpm typecheck`、`pnpm test`、`git diff --check`。
- 正式版本以 `public/manifest.json` 为准；`package.json` 同步保持一致。
- UI 优先紧凑、无无意义滚动，使用系统字体；深色模式优先使用 Tailwind `dark:`，避免新增手写 CSS。
- 导入/导出功能当前明确暂缓。
- Chrome 不允许扩展自动把自己固定到工具栏，只能在初次设置中引导用户操作。
