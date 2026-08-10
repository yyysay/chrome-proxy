# Auto Proxy

一个基于 Chrome Manifest V3、`chrome.proxy` 与 PAC 的极简规则分流扩展。整套运行配置使用 Mihomo 风格 YAML：节点、远程规则包与本地规则都在同一份文件中维护。

## 配置模型

```yaml
proxies:
  - name: local
    type: http
    server: 127.0.0.1
    port: 7890

rule-providers:
  google:
    type: http
    behavior: domain
    format: yaml
    url: https://example.com/google.yaml
    interval: 86400

rules:
  - RULE-SET,google,local
  - DOMAIN-SUFFIX,example.com,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  - MATCH,local
```

- `proxies`：一个或多个 HTTP 节点。
- `rule-providers`：远程规则包；`format` 仅支持 `yaml` / `list`，`behavior` 支持 `domain` / `ipcidr` / `classical`。
- `rules`：按顺序仅支持 `RULE-SET`、`DOMAIN`、`DOMAIN-SUFFIX`、`IP-CIDR`；必须且只能有一条最终 `MATCH` 作为兜底。
- 规则目标只能是 `DIRECT` 或一个节点名称。
- 不支持 `REJECT`、策略组、节点选择、`url-test`、负载均衡和 MRS。

远程规则下载失败时，相同名称与 URL 会继续使用上次有效缓存。PAC 按配置顺序生成，首条命中生效。配置页优先使用远程 YAML 订阅地址同步整份配置，也保留手动 YAML 与可视化编辑。

## 界面

- `配置`：优先同步远程 YAML；下方可手动编辑 YAML，并与节点、远程规则包和本地规则可视化编辑器双向同步。
- `工具`：规则命中测试，并选择一个配置节点查询其出口 IP、位置和运营商。
- Popup：仅开启或关闭当前配置生成的 PAC。
- Onboarding：首次粘贴 YAML 后直接应用并开启。

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
