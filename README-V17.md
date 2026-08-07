# Auto Proxy V17

V17 聚焦首次安装引导、界面布局、状态表达和样式维护方式。

## 首次安装引导

首次安装页改成可点击的三步 Stepper：

1. 确认代理订阅地址
2. 开启 Auto Proxy
3. 完成并关闭页面

默认代理订阅地址：

`https://dufs.ms.y3-3am.top/autoproxy/proxies.json`

默认域名已经加入 `public/manifest.json` 的 `host_permissions`。如果用户在引导页手动改成其他域名，页面会通过 optional host permission 请求对应访问权限。

## 高级设置

顶部状态统一为：

- `代理 · 健康`
- `代理 · 异常`
- `代理 · 检测中`

Toast 改为页面顶部中央显示。

设置页面使用居中的 `max-width` 内容容器；首次安装页同时水平、垂直居中。

## Popup

Popup 保持极简：

- 一个 ON / OFF 开关
- 一个「高级设置」入口

不显示出口、地址、健康缓存等诊断信息。

Chrome 工具栏不再使用 Badge 绿点：

- OFF：整枚 Auto Proxy 图标为中性灰
- ON：整枚 Auto Proxy 图标变绿色

图标均为透明背景，无黑色描边。

## Tailwind

V17 从三份大 CSS 文件迁移到 Tailwind CSS v4：

- 删除 `src/onboarding/onboarding.css`
- 删除 `src/popup/popup.css`
- 删除 `src/settings/settings.css`
- 新增 `src/ui/ui.css`，只保留 Tailwind 入口、字体主题和 dialog backdrop

绝大多数样式直接使用 utility class，后续调整 UI 不需要再维护数百行独立 CSS。

新增开发依赖：

- `tailwindcss`
- `@tailwindcss/vite`

## 验证

当前工作环境完成：

- Rule / Proxy Provider tests：15 / 15
- TypeScript noCheck 语法级检查：通过
- Settings required DOM：63 / 63
- Onboarding required DOM：9 / 9
- Popup required DOM：3 / 3

当前内部 npm 镜像没有 Tailwind 包，因此无法在该环境执行最终 `vite build`。在正常 npm/pnpm 公共源环境执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
