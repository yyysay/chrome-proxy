# Auto Proxy

一个基于 Chrome Manifest V3、`chrome.proxy` 与 PAC 的极简规则分流扩展。整套运行配置使用 Mihomo 风格 YAML：节点、远程规则包与本地规则都在同一份文件中维护。

## 配置模型

```yaml
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890

rules:
  - RULE-SET,google,local
  - DOMAIN-SUFFIX,example.com,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  - MATCH,local

rule-providers:
  google:
    type: http
    behavior: domain
    format: yaml
    url: https://example.com/google.yaml
    interval: 86400
```

- `proxies`：一个或多个 HTTP 节点。
- `rule-providers`：远程规则包；`format` 仅支持 `yaml` / `list`，`behavior` 支持 `domain` / `ipcidr` / `classical`。
- `rules`：按顺序仅支持 `RULE-SET`、`DOMAIN`、`DOMAIN-SUFFIX`、`IP-CIDR`；必须且只能有一条最终 `MATCH` 作为兜底。
- 可视化编辑产生的 YAML 固定按 `proxies`、`rules`、`rule-providers` 排列。
- 可视化编辑器可启停除 `MATCH` 外的规则；停用规则以 `# disabled-rule: ...` 注释保存，保持 Mihomo YAML 兼容且不会编译进 PAC。没有被启用规则引用的远程规则包也不会下载或定时更新。
- `IP-CIDR` 同时支持 IPv4 与 IPv6，例如 `10.0.0.0/8`、`::/127`。
- 规则目标只能是 `DIRECT` 或一个节点名称。
- 不支持 `REJECT`、策略组、节点选择、`url-test`、负载均衡和 MRS。

整份远程 YAML 默认每天自动同步，也可选择每小时、每 6/12 小时、每周或关闭。远程 YAML 与规则包在后端统一使用秒数周期，界面再转换成小时、天等易读单位；每个规则包仍独立遵循 YAML 中的 `interval`。手动覆盖远程配置会要求确认并只关闭整份 YAML 的自动同步，不影响规则包更新。

## 界面

- 高级设置使用全页面工作台布局，通过固定在底部的液态玻璃导航切换 `配置`、`工具`、`关于`。
- `配置文件`：优先同步远程 YAML；下方按节点、规则、远程规则包顺序可视化编辑，也可手动编辑 YAML。
- `工具`：规则命中测试，并选择一个配置节点查询其出口 IP、位置和运营商。
- Popup：显示当前网站实际命中的代理节点或 `DIRECT`，控制代理引擎；订阅地址默认隐藏，仅在编辑时展开；未应用配置时开关保持禁用。
- Onboarding：引导输入订阅地址，检测通过后自动同步规则、开启代理，并提醒固定到 Chrome 工具栏。

## 开发

推荐 Node.js 24 LTS 与 pnpm：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

开发监听使用：

```bash
pnpm dev
```

该命令会监听源码并持续构建 `dist`。在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”并加载 `dist`；代码变化完成构建后，在扩展卡片上重新加载。

示例配置见 [`examples/config.yaml`](examples/config.yaml)。
