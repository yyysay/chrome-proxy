# Auto Proxy · 项目上下文

更新日期：2026-08-10
当前版本：0.2.2

Auto Proxy 是一款基于 Chrome Manifest V3、`chrome.proxy` 与 PAC 的轻量规则分流扩展。项目已完成从“JSON 代理订阅 + 独立规则管理”到“单一 YAML 配置文件”的架构收敛。

## 当前产品形态

- YAML 是唯一运行配置来源，统一包含多 HTTP 节点、远程规则包和本地规则。
- 设置页只有两个主 Tab：`配置`、`工具`；配置排在第一位。
- `配置` 以远程 YAML 订阅为首要入口，手动 YAML 与可视化编辑器作为补充并保持双向同步。
- `工具` 只保留规则命中测试和按节点查询出口信息。
- Popup 只负责开启/关闭已应用配置生成的 PAC。
- 首次引导直接编辑 YAML，并可保存、应用和开启。
- 远程整份 YAML 订阅支持下载、校验、保存与应用，并持久化当前订阅地址。
- 原 JSON 代理订阅、手动代理、内建/default/custom rule-pack、策略来源、独立更新周期与三种 MATCH 模式已删除。

## YAML 数据模型

顶层只接受：

```yaml
proxies: []
rule-providers: {}
rules: []
```

约束：

- `proxies`：支持多个 `type: http` 节点；名称唯一。
- `rule-providers`：`type` 为 `http`，`format` 仅支持 `yaml` / `list`，`behavior` 支持 `domain` / `ipcidr` / `classical`，`interval` 单位为秒。
- `rules`：仅支持 `RULE-SET`、`DOMAIN`、`DOMAIN-SUFFIX`、`IP-CIDR`；必须且只能有一条最终 `MATCH` 兜底。
- 目标只能是 `DIRECT` 或具体节点名称。
- 不支持 `REJECT`、代理组、节点选择、`url-test`、负载均衡和 MRS。
- `behavior` 只负责解释远程规则输入；所有规则最终仍统一编译进 PAC。

## 运行链路

```text
Settings / Onboarding
  → APPLY_CONFIG_DOCUMENT
  → 校验 YAML、下载并校验 rule-providers
  → 保存配置与最后有效缓存
  → compileConfigRuntime
  → buildTargetedPacScript
  → chrome.proxy.settings

Popup / Chrome 生命周期
  → ENABLE_PROXY / reconcileProxy
  → 仅恢复当前已应用 YAML 的 PAC
```

- 没有已应用配置时，开启代理会明确报错，不存在内建兜底节点。
- 重新应用配置会清除旧的节点出口检测缓存。
- 远程配置与规则地址会被强制交给最终 `MATCH` 目标，避免后续同步被自身规则意外阻断。
- 规则包下载限制为 2 MB、10 秒超时；失败时只对相同 provider 名称与 URL 使用最后有效缓存。
- 自动更新由配置内 provider 的最短 `interval` 驱动，更新完成后在代理开启时重新生成 PAC。
- PAC 上限：20,000 条有效规则、1.5 MB。
- Chrome 丢失扩展控制时，后台根据持久化的 `desiredEnabled` 恢复 PAC。

## 工具行为

- 规则命中测试使用与 PAC 相同的 exact/suffix/keyword/IPv4 CIDR 语义，返回命中的规则及具体节点或 `DIRECT`。
- 节点出口检测由用户选择一个配置节点，临时让 `api.ip.sb` 请求经过该节点，结束后恢复原代理状态。
- 不再检测国内直连出口，也不再把网络检测结果联动到设置页或 Popup 的全局健康状态。

## 存储与迁移

保留的主要键：

- `configDocumentActive`
- `configDocumentYaml`
- `configDocumentUrl`
- `configProviderCache`
- `proxyState`
- `networkInfoCache`
- `diagnosticEvents`

存储 schema 已升级到 9。迁移会删除旧 JSON 订阅、手动代理、rule-pack、旧更新周期、fallback 及废弃的代理事件/PAC 报告键，不迁移为隐式配置。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/config/config-document.ts` | YAML 解析、数据结构和引用校验 |
| `src/config/rule-provider-parser.ts` | yaml/list provider 规范化 |
| `src/config/config-runtime.ts` | 配置存储、远程缓存、规则展开和自动更新 |
| `src/config/config-service.ts` | 配置应用、规则包刷新与命中测试 |
| `src/proxy/pac-builder.ts` | 多节点定向 PAC 生成与匹配语义 |
| `src/proxy/pac-controller.ts` | 配置专用 PAC 应用、开关、恢复与状态 |
| `src/background/message-handler.ts` | 精简后的运行消息协议 |
| `src/background/alarms.ts` | 仅处理配置 rule-provider 更新 |
| `src/settings/config-settings.ts` | 配置 Tab |
| `src/settings/tools-settings.ts` | 规则命中测试 |
| `src/settings/network-info.ts` | 网络信息工具 |
| `src/proxy/storage-migration.ts` | schema 8 旧数据清理 |

## 验证基线

提交前运行：

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

当前测试覆盖 YAML 模型校验、yaml/list/classical provider、缓存回退、多节点 PAC、代理开关与恢复、网络探测和规则命中语义。

开发统一使用 `pnpm dev` 监听构建 `dist`，通过 Chrome 加载已解压扩展进行验证。
