# Auto Proxy V15

V15 继续收敛“小白日常只用开关，高级用户进入设置”的产品边界。

## Popup

Popup 只保留：

- Auto Proxy 品牌与高级设置入口
- 已开启 / 已关闭 / 需要检查设置
- 一个 ON / OFF 开关

Popup 不再显示：

- 健康检测结果
- 当前代理名称
- 代理地址
- 代理出口 IP / GeoIP

网络健康和出口信息只在高级设置中展示。

## 默认分流规则

规则页主界面不再逐条展示产品默认规则，只显示一个摘要：

- 默认分流规则
- 规则组数 / 有效规则数
- 如有高级覆盖，会提示“已修改”数量

点击“管理”后才进入默认规则管理窗口。高级用户可以编辑：

- 规则名称
- 订阅 URL
- 默认动作 DIRECT / PROXY
- 本地规则内容
- 本地/订阅内容策略

默认规则始终自动启用，不提供开关。

### 恢复默认

修改过的 Managed Rule 在编辑器中会出现“恢复默认”。恢复时会：

1. 清除该规则的高级覆盖配置；
2. 清除对应自定义 source state；
3. 重新尝试下载代码内置的默认订阅；
4. 下载失败时仍使用 catalog 内置最小规则；
5. 如果 Auto Proxy 当前开启，则重新生成并应用 PAC。

Managed Rule 的高级覆盖保存在 `managedRuleOverrides`，不会污染 Custom Rules。

## 规则优先级

保持：

```text
Custom Rules
  > Managed Rules
  > 未命中策略
```

未命中策略仍支持：

- 直接连接
- 当前代理
- 系统代理

Managed Rules 的远程订阅下载仍强制经过当前有效代理。

## 首次安装页

首次安装页不展示代理地址或节点信息，只告诉用户：

1. 点击开启；
2. 完成后关闭页面；
3. 日常使用浏览器工具栏里的 ON / OFF。

只有需要自定义网络行为时才进入高级设置。

## 检查

V15 已执行：

```bash
node --experimental-strip-types --test tests/*.test.ts
```

现有测试：15 / 15 通过。

此外使用临时 Chrome API 类型 stub 进行严格 TypeScript 检查通过，并检查：

- settings.html required DOM：无缺失
- popup.html required DOM：无缺失
- onboarding.html required DOM：无缺失
- 修改的 TypeScript 文件均通过 Node TypeScript syntax check

正式构建仍建议在项目本机执行：

```bash
pnpm typecheck
pnpm test
pnpm build
```
