---
description: "招投标流程门禁：一个 tools/pre-execute guard，在会话最近解析的招标与调用的 tenderId 匹配之前，拒绝 bid_match_capabilities、bid_generate_section 与 bid_export，面向组合或调试招投标 profile 的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bid-guard

[English](README.md) | 中文

## 概述

`dsh-bid-guard` 安装一个 `tools/pre-execute` 监听器来强制招投标流程顺序：在会话解析出目标招标之前，`bid_match_capabilities`、`bid_generate_section`、`bid_export` 会被拒绝。门禁读取被维护的 `bidTender` 投影——绝不读原始事件日志——因此无论来自 bid 工具还是 `/bid` 命令的解析都能满足它，且判定在 resume 后依然成立。拒绝会返回一条面向模型的错误，指明缺失的第一步是 `bid_parse_tender`；其余调用原样委托。

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

把本包与工具运行时、会话投影注册表以及 `dsh-tool-bid`（注册本门禁读取的 `bidTender` 投影）一起挂载。它不带配置；被门禁的工具列表与"先解析"规则是固定的领域不变量。

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-tool-bid'
- name: '@deepseek-ai/dsh-bid-guard'
```

### 何时选择它

当招投标 profile 应确定性地拒绝乱序工具调用、而不依赖中心服务去拒绝未解析的 `tenderId` 时选择它。当中心服务自身的校验已足够时可以不装：本门禁是快速的、本地的、面向模型的拒绝，不是安全边界。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释门禁背后的设计决策；可观测行为在[使用本包](#use-this-package)中已完整覆盖。

### 设计哲学

- **读投影，绝不扫历史。** 全仓库已弃用对任意会话事件的同步读取；门禁经 `ctx.sessionProjections.stateOf` 读取被维护的 `bidTender` 投影，resume 安全且 O(1)。
- **失败即关闭。** 投影缺失（未挂 tool-bid）或招标未解析时读作 `null`/`undefined`，永远不等于请求的 `tenderId`，因此调用被拒绝。
- **把工具自己的事留给工具。** 缺 `tenderId` 参数或无所有者会话的调用原样委托，由工具自身的校验给出更精确的错误。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：被门禁工具列表与唯一的 pre-execute 监听器 |
| — | 不发布运行时 invariant 伴随包，因为门禁只是 `bidTender` 投影上的一个监听器，不拥有自己的持久状态。 |

### 导出形态

插件是函数/命名空间插件：导出 `name` / `inject` / `apply`，无默认导出。多出的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢掉 `inject`（见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 门禁机制

每次派发时，监听器把工具名与固定的门禁列表比对，读取并 trim 冻结的 `tenderId` 参数（与被门禁工具自身的 `requireField` 语义一致），解析所有者 agent 会话，并把 `stateOf(session, 'bidTender')` 与参数比较。只有完全匹配才委托。`bidTender` 投影未注册时以组合错误理由拒绝，指明 `@deepseek-ai/dsh-tool-bid`；已注册但最近招标不匹配时以流程理由拒绝，指明 `bid_parse_tender`。两种拒绝都返回 `{ kind: 'deny', reason }`，由工具运行时渲染为该调用的错误结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [bid 领域](../bid/README.zh.md) —— 本门禁读取的 `bid/*` 事件与 `bidTender` 投影声明。
- [tool-bid](../tool-bid/README.zh.md) —— 本门禁排序的工具，以及注册 `bidTender` 投影的插件。
- [招投标子系统](../../../docs/subsystems/bid.zh.md) —— bid 接缝、事件与生成的服务 API。

-----

<a id="model-experience"></a>
## 模型体验

### 门禁可见性

#### 模型看到什么

门禁不添加任何 schema 或提示词区段。被拒调用的工具结果变成 `Error: <tool> needs a parsed tender: call bid_parse_tender for tenderId "<id>" first`，作为该调用普通的错误结果进入对话，并告诉模型确切的补救步骤。被放行的调用与没有门禁的组合无法区分。

#### Token 影响

只有拒绝会增加 token：每次被拒调用一行固定形态的错误，留在历史中直到压缩。

#### KV Cache 影响

无；监听器在派发时运行，对请求前缀毫无贡献。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了门禁不适用的场景。它们是本包当前的约束，不是任务待办。

- **依赖 `bidTender` 投影** —— 由 `dsh-tool-bid` 注册；缺了它，每个被门禁的调用都会以组合错误理由被拒（失败即关闭），包括合法的调用。
- **最近招标语义** —— 投影只保存一个招标，因此门禁只放行对该会话最近解析招标的操作；更早的招标在重新解析前会被拒绝。
- **是建议而非安全边界** —— 它省去一次无意义的中心服务往返并引导模型；权威校验者仍是中心服务。
- **只门禁三个工具** —— `bid_parse_tender` 有意不受门禁；更深的顺序约束（例如导出前要求已匹配）是延后工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决的问题与方向。它明确不具权威性——已发布的行为、限制与被接受的理由见上文各节与包代码。

#### 未来：更丰富的顺序约束

开放、未决：在至少生成一个章节后才放行 `bid_export`，以及一个按招标记录的已解析集合投影，使任何曾解析过的招标都可操作。两者都会改变拒绝行为并需要新增或扩展投影。

</details>
