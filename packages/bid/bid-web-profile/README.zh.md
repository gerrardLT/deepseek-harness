---
description: "随产品交付的投标 Web profile 层：在标准 base 与 Web bundle 之上加入 bid 服务、工具、命令、流程守卫和项目侧边栏。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-bid-web-profile

[English](README.md) | 中文

## 概述

选择 `dsh --profile bid-web`，可在标准 Web 应用中加入投标工作流。随附 profile 将此 bundle 放在 `dsh-base` 与 `dsh-web-app` 之后；它挂载中心服务客户端、模型工具、`/bid` 命令、流程守卫和 Web 项目侧边栏。部署设置来自环境变量，token 本身不会进入配置。bundle 复用 `dsh-base` 已提供的 jobs、subagent 与文件系统服务。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

用以下命令启动随附组合：

```text
pnpm dsh --profile bid-web
```

launcher 会按顺序用 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和此 bundle 自动初始化 profile。`BID_API_BASE_URL` 必填。`BID_TOKEN_ENV` 指定保存委托 token 的环境变量名称；默认值为 `BID_DELEGATION_TOKEN`，patch 文档不会读取 token 值。

| 环境变量 | 默认值 | 配置目标 |
|---|---:|---|
| `BID_API_BASE_URL` | 必填 | 中心 API base URL |
| `BID_TOKEN_ENV` | `BID_DELEGATION_TOKEN` | 静态 token 环境变量名称 |
| `BID_SERVICE_TOKEN_ENV` | 无 | 用于动态换取委托 token 的服务凭证环境变量 |
| `BID_DELEGATION_SUBJECT` | 无 | 动态换取委托 token 所代理的 WorkFusion 用户名 |
| `BID_MAX_TENDER_BYTES` | `104857600` | 招标文件最大字节数 |
| `BID_MAX_EXPORT_BYTES` | `104857600` | 导出文件最大字节数 |
| `BID_TIMEOUT_MS` | `1800000` | 中心 API 请求超时 |
| `BID_READ_CHUNK_BYTES` | `1048576` | 招标文件读取块大小 |
| `BID_SUBAGENT_PROVIDER` | `spawn` | 章节准备 subagent provider |
| `BID_MAX_CONCURRENT_SECTIONS` | `4` | 并发章节 worker 数 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

patch 在 base 与 Web 层之后插入五个领域配置行：`bid`、`tool-bid`、`command-bid`、`bid-guard` 与 `bid-client`。它不会重复加入 jobs、subagent 或文件系统包，因为 base 层已经提供这些服务与工具。后续 profile、home 与 `--patch` 层可以按 id 替换任何配置行。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 精确的领域配置行与环境表达式 |
| [`src/index.ts`](src/index.ts) | 包格式要求的空模块入口 |
| [`tests/profile.spec.ts`](tests/profile.spec.ts) | 精确的包、配置行与 Loader 表达式组合检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Bid 包组](../README.zh.md)——每项挂载领域行为的所有者。
- [app-boot profiles](../../boot/app-boot/README.zh.md#profiles)——profile 初始化与层顺序。
- [Base bundle](../../bundle/base/README.zh.md)——共享的 jobs、subagent 与文件系统组合。

-----

<a id="model-experience"></a>
## 模型体验

间接，通过 `tool-bid`；它持有此 bundle 所选择的面向模型 schema 与结果。

#### KV Cache 影响

挂载的 bid 工具 schema 会加入工具前缀。更改 bundle 或其工具配置行会改变后续请求的该前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- profile 需要可访问的中心 bid API，以及 `BID_TOKEN_ENV` 所指定环境变量中的 token。
- 数字环境变量通过 JavaScript `Number` 转换；所属插件在加载时拒绝无效边界值。
- 此 Web profile 是随产品交付的 bid 界面；当前不提供 bid 专用 headless profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
