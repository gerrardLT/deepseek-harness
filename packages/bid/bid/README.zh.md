---
description: "面向选择、组合或排查招投标集成的开发者与维护者的 bid 能力接缝（ctx.bid）说明：一个连到中心 bid REST 服务的 HTTP 客户端，外加 bid 领域事件与投影声明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bid

[English](README.md) | 中文

## 概述

用 `ctx.bid` 连到中心 bid REST 服务：解析招标、匹配能力、生成技术标章节、导出成品标书，每一步都走带委托 JWT bearer 的鉴权 HTTP。本包还拥有 bid 领域词汇——`bid/*` 会话事件与工具、卡片赖以构建的 `bidTender`/`bidOutline`/`bidMatch` 投影。消费者注入 `ctx.bid` 而非各自 fetch，因此 base URL、token 变量与超时只配置一次。它本身不注册任何面向模型的东西；那层由 bid 工具拥有。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当招投标工具或命令需要连到中心 bid REST 服务时使用 `ctx.bid`。它是每个 bid 消费者赖以构建的单一接缝，因此 base URL、委托 token 与超时只配置一次，而非每个调用方各配一次。它需要一个可达的中心服务；没有本地兜底，服务不可达时调用会失败。

### 最小配置

`apiBaseUrl`、`maxTenderBytes` 与 `maxExportBytes` 均为必填；组合省略任一字段都会在加载时失败。`tokenEnv` 指定持有委托 JWT 的环境变量名；`timeoutMs` 限定每个请求（包括认证后的导出下载）的时长。

```yaml
- id: bid
  name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
    tokenEnv: BID_DELEGATION_TOKEN
    maxTenderBytes: 104857600
    maxExportBytes: 104857600
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiBaseUrl` | 必填 | 中心 bid REST 服务的 base URL（仅 http 或 https）；缺尾斜杠时会补上 |
| `tokenEnv` | `BID_DELEGATION_TOKEN` | 调用时读取以取静态 `Authorization: Bearer` token 的环境变量 |
| `serviceTokenEnv` | 选填 | 保存用于向中心服务换取短期委托 token 的服务凭证环境变量 |
| `delegationSubject` | 选填 | 换取到的短期委托 token 代表的 WorkFusion 用户名；与 `serviceTokenEnv` 联用 |
| `timeoutMs` | `1800000` | 每请求超时（毫秒）；与调用方提供的取消 signal 组合 |
| `maxTenderBytes` | 必填 | 流式上传招标文件的包含式字节上限 |
| `maxExportBytes` | 必填 | 完整下载 DOCX 的包含式字节上限 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-bid)是受支持字段的穷尽式真源。

### 每次调用做什么

`parseTender`、`matchCapabilities` 与 `generateSection` 调用各自的服务相对端点，并校验完整 JSON 响应。`exportBid` 校验 `/export` 描述符，只携带同一 bearer 访问 `apiBaseUrl` 下受保护的 `downloadPath`，再通过 `ctx.fs` 将有界 DOCX 流式写入当前 Session 工作区。原子文件写入完成后，调用方才能追加 `bid/export-produced`；取消、无效描述符、超限 body 与传输失败不会留下部分目标文件或 Session 事件。每个请求在调用时从 `tokenEnv` 读取委托 token，因此轮换 token 无需重载即可生效。

### 领域词汇

`bid/tender-loaded`、`bid/capability-matched`、`bid/section-generated` 与 `bid/export-produced` 会话事件，以及 `bidTender`、`bidOutline`、`bidMatch` 投影，都在此处声明，是它们的唯一归属。bid 工具追加事件并注册投影；本包只声明，两者都不注册。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释接缝背后的设计；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计

- **单接缝、单套已配置的传输。** `ctx.bid` 是一个 Cordis 服务；消费者注入它而非各自 fetch，因此 base URL、token 与超时集中在一处。
- **显式配置、失败要响。** `apiBaseUrl` 必填且无默认值，因此配置错误的组合会在加载时失败，而不是调用一个错误的 URL。
- **调用时读取 token。** 委托 JWT 每次请求从 `tokenEnv` 读取，因此轮换无需重载。
- **稳定契约覆盖可替换传输。** `BidClient` 接口是契约；HTTP 实现可以更换而不触及消费者。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `BidService`（默认导出）：`ctx.bid` HTTP 客户端、其 `Config`、以及 `Context.bid` 增强 |
| [`src/types.ts`](src/types.ts) | bid 领域类型、`bid/*` 事件与投影声明、以及 `BidClient` 契约的唯一归属处 |
| [`src/client.ts`](src/client.ts) | types 出口的客户端命名空间再导出 |
| — | 不发布运行时不变式伴生入口，因为本包自身不追加任何会话事件；追加 `bid/*` 事件的 bid 工具在不可信服务数据到达日志后拥有任何持久形态不变式。 |

### 导出形态

本包的默认导出是 `BidService` 类，作为 Cordis 服务加载，而非 name/inject/apply 命名空间插件。加载它会注册 `ctx.bid`；`Context.bid` 类型来自 [src/index.ts](src/index.ts) 中的增强。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [tool-bid](../tool-bid/README.zh.md) — 此接缝之上面向模型的 bid 工具。
- [会话投影](../../session/session-projection/README.zh.md) — 此处声明的 `bidTender`/`bidOutline`/`bidMatch` 投影的载体。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-bid) — 每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

通过注入 `ctx.bid` 的 bid 工具间接影响；本接缝自身不注册任何 prompt、schema 或结果文本。

#### KV Cache 影响

不直接失效；由消费它的 bid 工具拥有任何请求前缀的变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了接缝不提供什么。它们是当前的包约束，不是路线图。

- **需要可达的中心服务** — 没有本地兜底；中心 bid REST 服务不可达时调用会失败。
- **仅四个操作** — 解析、匹配、生成、导出；评审与知识检索在后续阶段到来。
- **每个组合一个委托 token** — 从单个环境变量读取；按用户或按任务铸造 token 延期处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

尚未决定的开放项：按请求的委托作用域（每次调用铸造一个任务作用域 JWT，而非一个共享 token），以及长的生成与导出调用的流式进度。两者都延期到中心 REST 端点存在之后。

</details>
