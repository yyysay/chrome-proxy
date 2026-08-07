# Auto Proxy V17.1 Hotfix

V17.1 修复首次引导保存代理订阅时可能出现的：

`Failed to set icon 'icons/icon-32.png': Failed to fetch`

## 修复内容

- 动态工具栏图标不再依赖运行时读取 `icons/icon-active-*.png`。
- Service Worker 直接生成透明 `ImageData` 图标：关闭为中性灰，开启整枚图标为绿色。
- `chrome.action.setIcon()`、`setTitle()`、`setBadgeText()` 全部改为非关键 UI 更新。
- 即使 Chrome action 图标更新失败，也不会再阻断：
  - 保存代理订阅
  - 首次引导进入下一步
  - 开启 / 关闭代理
  - 手动覆盖
  - 未命中策略切换
- 保留 Manifest 静态图标作为默认 / 降级显示。

## 验证

规则和代理提供器测试：15 / 15 通过。

本机建议重新构建并重新加载扩展：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

然后在 `chrome://extensions` 中重新加载 `dist`。
