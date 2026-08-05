# Rule Proxy Lab · 最小环境测试

这是第一阶段的最小 Chrome Manifest V3 项目，用于验证：

- TypeScript 编译
- Vite 多入口构建
- Manifest V3 Service Worker
- 扩展安装后自动打开 onboarding 页面
- Popup 与 Service Worker 消息通信
- `chrome.storage.local` 读写

当前版本可保存本地 HTTP 代理配置，并通过测试规则生成 PAC 分流。

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

## 2. 立即加载预构建版本

压缩包已经包含一个预构建的 `dist`，可以先跳过依赖安装，直接按第 4 节加载测试。

## 3. 安装依赖并自行构建

```powershell
cd rule-proxy-lab
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

构建完成后会生成 `dist` 目录。

## 4. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 `dist` 目录
5. 首次安装后应自动打开 onboarding 页面
6. 点击浏览器工具栏中的扩展图标
7. 点击“检测后台通信”
8. 页面显示“Service Worker 通信正常”即测试通过

## 5. 开发监听

```powershell
pnpm dev
```

Vite 会在文件变化后重新构建 `dist`。修改代码后，仍需回到 `chrome://extensions/` 点击扩展卡片上的“重新加载”。

## 当前规则支持

- `DOMAIN`
- `DOMAIN-SUFFIX`
- `DOMAIN-KEYWORD`
- `FINAL` / `MATCH`

规则保持原始顺序写入 PAC，首条命中后立即返回。没有 `FINAL` 或 `MATCH` 时默认直连。
