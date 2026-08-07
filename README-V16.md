# Auto Proxy V16

本版本继续收敛普通用户入口，并改善高级设置的信息层级与可读性。

## 本次变化

### Popup
- 删除健康状态、出口信息、说明文字和状态 Toast。
- Popup 只保留 Auto Proxy 总开关与「高级设置」。
- 开启/关闭结果直接由开关状态表达；失败时恢复后台实际状态，不再额外弹提示。

### 代理订阅
- 「订阅地址」右侧徽标不再显示“已更新”。
- 更新成功时显示最后成功更新时间，例如 `08/07 17:22`。
- 更新失败时显示红色「更新失败」。
- 如果已有可用缓存但本次更新失败，下方仍显示当前代理与上次成功更新时间。

### 代理健康
- 高级设置右上角状态明确显示「代理健康 · 健康 / 异常 / 检测中」。
- 健康判定规则不变：本地直连 IP 与代理出口 IP 均成功取得且不一致才为健康。

### 字体与 UI
- 放大高级设置的正文、辅助说明、表单、按钮、规则列表、诊断信息和弹窗字号。
- 首次引导页同步放大，避免不同页面的视觉尺度不一致。
- Popup 使用更简洁的大尺寸开关卡片。

### 工具栏状态点
- 开启状态不再用带背景的空白 Badge（会呈现方块）。
- 改为透明 Badge + 绿色圆点字符，呈现为小绿点。

### V15 页面同步修复
- 补齐默认规则管理弹窗及编辑器缺失的 DOM 入口。
- `settings.html`、`popup.html` 与 V15 的 TS/CSS 重新对齐。

## 验证
- 现有自动测试：15 / 15 通过。
- 使用本地 Chrome API stub 进行 TypeScript 检查：通过。
- Settings required DOM：63 / 63。
- Popup required DOM：3 / 3。
- Onboarding required DOM：6 / 6。

当前环境无法从内部 npm registry 获取 `@types/chrome`，因此正式依赖下的 `pnpm typecheck` / `pnpm build` 请在本机执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
