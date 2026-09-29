---
description: "DeepSeek Harness 会话日志之上的人类 /bid 斜杠命令：parse、match、generate、export 子命令，经 ctx.bid 接缝直接执行一次招标/投标操作，并追加与工具相同的 bid/* 事件，面向选择、组合或调试该命令的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-bid

[English](README.md) | 中文

## 概述

`dsh-command-bid` 注册人类 `/bid` 斜杠命令：`parse`、`match`、`generate`、`export` 四个子命令，经 `ctx.bid` 接缝直接对中心 bid REST 服务执行一次招标/投标操作，无需模型轮次。每个子命令追加与 `dsh-tool-bid` 工具相同的持久 `bid/*` 事件，并把该事件的序号作为结果的 `sourceEventSeq` 返回，因此 `bidTender`/`bidOutline`/`bidMatch` 投影卡片的更新与工具调用后完全一致。它是与模型调用工具并列的确定性人类入口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当人类应从编辑器确定性地驱动某一个投标步骤——解析招标、匹配能力、生成章节或导出——而无需让模型选择工具时，使用本包。把它与命令注册表和 `ctx.bid` REST 接缝一起挂载是唯一的准备工作；随后用户输入 `/bid <子命令> <参数>`。

### 何时选择它

当参数已知、想要一次不经模型轮次的直接动作时选择它。当应由模型从自然语言决定步骤时，改用 `dsh-tool-bid` 工具。两个入口写入相同的 `bid/*` 事件，因此无论哪一个运行，最终的会话状态与卡片都一致。

### 挂载

命令自身不带配置；它注入 `ctx.bid` REST 接缝，所以先带 `apiBaseUrl` 挂载该接缝：

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
- name: '@deepseek-ai/dsh-command-bid'
```

`apiBaseUrl` 与委托 token 在 [`@deepseek-ai/dsh-bid`](../bid/README.zh.md) 上配置。

### 每个子命令做什么

| 子命令 | 参数 | 发送给 `ctx.bid` | 追加事件 |
|---|---|---|---|
| `/bid parse` | `<path> <title…>` | `parseTender({ path, title })` | `bid/tender-loaded` |
| `/bid match` | `<tenderId>` | `matchCapabilities({ tenderId })` | `bid/capability-matched` |
| `/bid generate` | `<tenderId> <sectionId>` | `generateSection({ tenderId, sectionId })` | `bid/section-generated` |
| `/bid export` | `<tenderId>` | `exportBid({ tenderId })` | `bid/export-produced` |

参数以空白分隔；`parse` 把 path 之后的所有 token 拼成 title。缺少必填参数时返回用法行作为错误结果，不发生 REST 往返；中心服务失败时把其消息作为错误结果返回，而不是让派发被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释命令背后的设计决策；可观测行为在[使用本包](#use-this-package)中已完整覆盖。

### 设计哲学

- **一个接缝，两个入口。** 命令与 `dsh-tool-bid` 工具都调用 `ctx.bid` 并追加相同的 `bid/*` 事件，因此人类与模型两个入口汇聚到同一份持久状态。
- **就地失败。** 参数与中心服务失败返回一个 `kind: 'error'` 结果供编辑器渲染，绝不拒绝派发。
- **拆卸时静默。** 注册是一个 effect，在注销前排空进行中的操作，因此拆卸不会搁置一个长时间的 `generate`/`export` 调用。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`/bid` 注册、子命令派发、拆卸排空 |
| — | 不发布运行时 invariant 伴随包，因为 `@deepseek-ai/dsh-bid` 领域拥有 `bid/*` 词汇，本命令只是重新发出它。 |

### 导出形态

插件是函数/命名空间插件：导出 `name` / `inject` / `apply`，无默认导出。多出的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢掉 `inject`（见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 结果与事件配对

成功的子命令返回 `{ kind: 'success', text, sourceEventSeq }`，其中 `sourceEventSeq` 是它刚追加的 `bid/*` 事件的序号。派发表面用该序号渲染更丰富的投影卡片而非纯文本，正如它对工具事件所做的那样。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [bid 领域](../bid/README.zh.md) —— `ctx.bid` REST 接缝，以及本命令重新发出的 `bid/*` 事件与投影声明。
- [tool-bid](../tool-bid/README.zh.md) —— 从自然语言写入相同事件的模型调用工具。
- [commands](../../interaction/commands/README.zh.md) —— 本包据以注册的命令注册表、`CommandInvocation` 与 `CommandResult`。

-----

<a id="model-experience"></a>
## 模型体验

### /bid 调用本身

#### 模型看到什么

什么都看不到。`/bid` 是人类命令：派发器记录 `command/run` 与 `command/done`，二者仅入日志、绝到达模型请求。模型不会收到 `/bid` schema，也从不选择运行它。

#### Token 影响

无模型请求 token；命令完全绕过模型。

#### KV Cache 影响

调用本身无影响。

### 追加的 bid/* 事件

#### 模型看到什么

每个子命令追加与 `dsh-tool-bid` 工具相同的 `bid/tender-loaded`、`bid/capability-matched`、`bid/section-generated` 或 `bid/export-produced` 事件。后续模型请求经 `bidTender`、`bidOutline`、`bidMatch` 投影重建招标、匹配、大纲与导出状态，正如工具调用后那样，因此人类与模型两个入口留下相同的模型可见状态。

#### Token 影响

追加的事件只经其折叠进的投影到达请求，与工具的开销一致。

#### KV Cache 影响

只追加；事件跟随可复用的请求前缀，不使既有 KV-cache 条目失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了命令不适用的场景。它们是本包当前的约束，不是任务待办。

- **需要命令注册表与 bid REST 接缝** —— 命令注入 `ctx.commands` 与 `ctx.bid`；未挂载 `@deepseek-ai/dsh-commands` 与 `@deepseek-ai/dsh-bid` 的组合无法加载它，且中心服务不可达时子命令失败。
- **长操作阻塞命令轮次** —— `generate` 与 `export` 就地等待中心服务；整份标书生成的 `ctx.jobs` 后台编排是延后工作。
- **空白分隔参数** —— `parse` 的 path 必须是单个 token（只有 title 可含空格），不支持引号或旗标语法。
- **单一所有者作用域** —— 事件追加到发起调用的 agent 自己的会话，与工具的单一所有者状态一致。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
