# Rule Proxy Lab · 最小环境测试

这是一个基于 Chrome Manifest V3 和 PAC 的规则分流扩展。

- TypeScript 编译
- Vite 多入口构建
- Manifest V3 Service Worker
- 扩展安装后自动打开 onboarding 页面
- Popup 与 Service Worker 消息通信
- `chrome.storage.local` 读写

当前版本支持自定义规则订阅、规则优先级、三种兜底策略和局域网 HTTP 代理连通性检查。

## 1. 环境要求

推荐使用 Node.js 24 LTS。

在 PowerShell 中检查：

```powershell
node -v
npm -v
```

安装或启用 pnpm：

```powershell
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

如果 `corepack enable` 因权限失败，可以改用：

```powershell
npm install -g pnpm
```

## 2. 安装依赖并开始开发

```powershell
cd chrome-proxy
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Vite 会持续更新 `dist` 目录。

## 3. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 `dist` 目录
5. 首次安装后应自动打开 onboarding 页面
6. 点击浏览器工具栏中的扩展图标
7. 修改代码后，在扩展卡片上点击“重新加载”

## 4. 开发监听

```powershell
pnpm dev
```

Vite 会在文件变化后重新构建 `dist`。修改代码后，仍需回到 `chrome://extensions/` 点击扩展卡片上的“重新加载”。

## 当前规则支持

- `DOMAIN`
- `DOMAIN-SUFFIX`
- `DOMAIN-KEYWORD`

规则保持原始顺序写入 PAC，首条命中后立即返回。兜底行为不属于规则文本，统一由设置页的 `MATCH` 决定：本地直连、局域网代理或系统代理。

规则按“自定义规则 → 默认规则 → 内置规则”的顺序匹配。默认规则来自产品预设的远程订阅，内置规则随扩展代码发布且只读。重复规则会合并；动作冲突时保留较早出现的规则。启用的远程规则按设置的周期自动更新，下载失败时继续使用已有缓存，内置规则始终保留基础分流能力。

内容策略没有跨来源回退：

- `subscription-first`（默认）：只使用远程下载内容；远程为空时规则为空。
- `local-first`：只使用本地规则；本地为空时规则为空。
- `merge`：合并远程与本地规则并去重，任一来源都可以为空。

## 修改默认规则

默认规则目录统一维护在 `src/rule-packs/catalog.ts` 的 `DEFAULT_RULE_PACKS` 中。增加、删除或调整默认规则时，只需要修改这里的定义；设置页会根据目录自动生成，不需要手动修改 HTML。

- `id`：稳定且唯一的规则标识，发布后不要随意更改。
- `name`：设置页显示名称。
- `defaultUrl`：远程规则订阅地址。
- `defaultAction`：连接策略，支持 `PROXY` 或 `DIRECT`。
`BUILTIN_RULE_PACKS` 是随扩展发布的隐藏兜底规则，不属于设置页中的默认规则。只有调整规则模型或存储行为时，才需要修改 `repository.ts` 和 `service.ts`。
