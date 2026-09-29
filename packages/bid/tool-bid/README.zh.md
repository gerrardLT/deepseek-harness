---
description: "面向在 DeepSeek Harness 会话日志上选择、组合或排查招投标工具的用户与维护者的说明：解析、能力匹配、章节生成与导出，每个都是一条持久的 bid/* 事件，配 bidTender/bidOutline/bidMatch 投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-bid

[English](README.md) | 中文

## 概述

`dsh-tool-bid` 为 agent（智能体）提供四个会话日志之上的原生招投标工具：`bid_parse_tender`、`bid_match_capabilities`、`bid_generate_section` 与 `bid_export`。每个都通过 `ctx.bid` 接缝委托给中心 bid REST 服务，并追加一条持久的 `bid/*` 事件；`bidTender`、`bidOutline`、`bidMatch` 投影向 UI 提供最新状态。它是招投标系统原生融入 DeepSeek Harness 的入口：工具名、事件、投影与卡片在后端更换时保持稳定。每个工具都归属调用它的那一个 agent 会话。

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

当 agent 应在其会话内开展招投标工作时使用本包：加载一份招标、把企业档案与之匹配、起草其技术标章节、导出成品文档。把它与工具运行时、会话投影注册表、以及 `ctx.bid` REST 接缝一起挂载即是全部安装；随后 agent 按此顺序调用这些工具。

### 何时选择它

当一个 agent 会话应拥有招投标状态、且按键整值替换即可接受时选择它——这是"先加载后作业"类工具的常见形态。当多个 agent 必须共享同一份已加载招标，或你需要按字段增量编辑时，避免使用它：状态归属单个 agent，且每个事件替换其投影值。每个工具都需要一个 agent 会话；从不运行 agent 的纯自动化平面无法使用它们。

### 挂载方式

这些工具自身不带任何配置；它们注入 `ctx.bid` REST 接缝，因此先挂载该接缝并给出其 `apiBaseUrl`：

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
- name: '@deepseek-ai/dsh-tool-bid'
```

`apiBaseUrl` 与委托 token 在 [`@deepseek-ai/dsh-bid`](../bid/README.zh.md) 上配置；每个工具把去空白后的参数发给对应的 `ctx.bid` 方法，并记录它返回的结果。

### 每个工具做什么

| 工具 | 发给 `ctx.bid` | 追加事件 | 折叠进 |
|---|---|---|---|
| `bid_parse_tender` | `parseTender({ path, title })` | `bid/tender-loaded` | `bidTender` |
| `bid_match_capabilities` | `matchCapabilities({ tenderId })` | `bid/capability-matched` | `bidMatch` |
| `bid_generate_section` | `generateSection({ tenderId, sectionId })` | `bid/section-generated` | `bidOutline`（按 sectionId upsert） |
| `bid_export` | `exportBid({ tenderId })` | `bid/export-produced` | —（仅结果） |

每次调用在 REST 调用前对必填字段去空白并拒绝空值，因此参数不合法会显式失败，不产生往返也不写持久数据。

### 单一归属

招投标状态归属创建它的那一个 agent 会话——子代理与其他 agent 各自保有自己的状态，无法在 agent 之间共享。来自 agent 会话之外的调用会被拒绝，因此 agent 会得知调用失败，而不是静默地写到无处。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指向实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

工具建立在三条承诺之上：

- **状态存于日志。** 每个 `bid/*` 快照存在于事件溯源的会话日志上，因此持久性、回放与 resume 重建都来自日志，而非某个服务。
- **单一归属。** 状态归属调用的 agent 会话；没有共享作用域，非 agent 调用方会被拒绝。
- **稳定接缝覆盖可替换后端。** 工具名、事件、投影与卡片是持久约定；工作通过 `ctx.bid` 委托给中心 bid REST 服务，因此后端可以更换而不触及模型或 UI 所见。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：四个工具注册、`bidTender`/`bidOutline`/`bidMatch` 投影单元、以及共享的 `agentSession`/`requireField` 校验辅助函数 |
| [`src/types.ts`](src/types.ts) | 从 `@deepseek-ai/dsh-bid` 再导出 `BidTender`/`BidSection`/`BidMatch`/`BidExport` 载荷类型；事件与投影声明位于那个领域包 |
| [`src/client.ts`](src/client.ts) | types 出口的客户端命名空间再导出 |
| — | 不发布运行时不变式伴生入口，因为 `@deepseek-ai/dsh-bid` 领域拥有 `bid/*` 词汇，并会在不可信的 REST 来源数据于生产流入时承载任何持久形态不变式。 |

### 导出形态

插件是函数/命名空间插件：它导出 `name` / `inject` / `apply`，不导出 default。多出的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢弃 `inject`（见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 会话投影

当组合挂载 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.zh.md)）时，本包在一个被注入的子上下文上注册三个单元：`bidTender`（最近的 `bid/tender-loaded`）、`bidMatch`（最近的 `bid/capability-matched`）、`bidOutline`（每个 `bid/section-generated`，按 `sectionId` 取最新、保序）。每个在其首个事件前为 `null`，且不因无关事件改变。这些键在领域包中并入 `SessionProjectionMap`；单元注册见 [src/index.ts](src/index.ts)。

### 调用机制

每次调用解析归属会话、去空白并校验其必填字段、await 对应的 `ctx.bid` 方法、把返回的载荷作为一条 `bid/*` 会话事件追加、并返回渲染文本；当前值始终是日志中最近的匹配事件（回放时后写者胜）。精确步骤见 [src/index.ts](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读这些页面。它们从 REST 接缝、会话投影延伸到生成的目录。

- [bid 领域](../bid/README.zh.md) — 这些工具消费的 `ctx.bid` REST 接缝与 `bid/*` 事件、投影声明。
- [会话投影](../../session/session-projection/README.zh.md) — `bidTender`/`bidOutline`/`bidMatch` 投影载体及其 wire 帧。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-bid) — 模型收到的四个工具 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型在 [`@deepseek-ai/dsh-tool-bid`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-bid) 下看到四个生成的 schema：`bid_parse_tender`（`path`、`title`）、`bid_match_capabilities`（`tenderId`）、`bid_generate_section`（`tenderId`、`sectionId`）、`bid_export`（`tenderId`），均为必填字符串。每个描述说明在"解析→匹配→生成→导出"顺序中何时调用它。

#### Token 影响

在工具可见的每个请求上，四个工具有固定的 schema 成本；描述与 schema 稳定。

#### KV Cache 影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使从这些 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

每个助手工具调用保留其参数。成功为每个工具返回一行固定形态的文本——`Loaded tender ...`、`Matched N requirements, M gaps ...`、`Generated section ...`、`Started whole-bid generation job ...` 或 `Exported bid to ...`。稳定的失败是 `Error: invalid <domain>: \`<field>\` must be a non-empty string`、`Error: <tool> requires an owning agent session`，以及中心服务失败 `Error: bid REST <path> failed with status <code>`。完整的 `bid/*` 会话事件是 UI 与回放状态，不是第二条模型消息。

#### Token 影响

Token 增长随调用参数扩展，这些参数会保留到 compaction 为止。每个结果本身小且形态固定。

#### KV Cache 影响

仅追加；新可见内容跟随可复用的请求前缀，不使既有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了工具何时不适用。它们是当前的包约束，不是任务待办。

- **需要 bid REST 接缝** — 这些工具注入 `ctx.bid`；未挂载 `@deepseek-ai/dsh-bid` 的组合无法加载它们，且中心服务不可达时调用会失败。
- **仅单一归属作用域** — 招投标状态归属那一个调用的 agent 会话；共享与跨 agent 作用域是刻意取舍，非 agent 调用方会被拒绝。
- **按键整值替换** — 没有按字段增量编辑，也没有回读工具；`bidOutline` 按 `sectionId` 整节 upsert，其余投影整体替换。
- **任务状态仅在进程内** — `bid_generate_bid` 作为归属当前 agent 的 `ctx.jobs` 任务运行；使用 `jobs-local` 的部署在进程重启后会丢失任务记录，但父 Session 和中心服务中的章节结果仍然持久。
- **整份生成要求章节清单** — 缺少 `sections` 的旧 tender 事件仍可回放，但不能启动 `bid_generate_bid`；需重新解析 tender 以取得当前章节清单。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的开放问题与方向。它明确不具权威性——已发布的行为、限制与被接受的依据位于上面的各节与包代码中。

#### 未来：独立标书评审

尚未决定的开放项：在中心服务暴露评估流水线后的一个评审工具。它会新增评审事件与投影，并改变模型可见的工具集。

</details>
