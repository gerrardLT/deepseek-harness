---
description: "bid 组地图：把“招标到中标”的招投标能力作为中心 REST 服务之上的稳定接缝，含 ctx.bid 领域、模型工具与用户命令，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/bid

[English](README.md) | 中文

## 概述

bid 组把“招标到中标”的招投标能力作为中心 REST 服务之上的稳定接缝融入 Harness。`bid` 领域拥有 `ctx.bid` HTTP 客户端以及持久的 `bid/*` 会话事件与投影；`tool-bid` 提供四个面向模型的工具，`command-bid` 提供用户 `/bid` 命令，`bid-guard` 在招标被解析前拒绝面向招标的工具。繁重的解析、能力匹配、章节生成与导出在中心服务运行，因此后端变化时 Harness 表面保持稳定。每个会话的招投标状态归属创建它的那一个 agent。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`bid`](bid/README.zh.md) | `ctx.bid` HTTP 客户端接缝，以及 `bid/*` 事件与投影声明 | `ctx.bid` |
| [`bid-guard`](bid-guard/README.zh.md) | pre-execute 流程门禁：招标解析前拒绝面向招标的工具 | 监听 `ctx.tools` |
| [`tool-bid`](tool-bid/README.zh.md) | 模型工具 `bid_parse_tender`、`bid_match_capabilities`、`bid_generate_section`、`bid_export` | 注册到 `ctx.tools` |
| [`command-bid`](command-bid/README.zh.md) | UI 命令平面中的用户 `/bid` 命令 | 注册到 `ctx.commands` |
| [`bid-client`](bid-client/README.zh.md) | 由 Host 中介的项目列表与 Web 右侧边栏标签页 | 挂载 Host 与 Client 两端 |
| [`bid-web-profile`](bid-web-profile/README.zh.md) | 基于 base 与 Web 的随附 `bid-web` profile 层 | —（仅 patch） |

-----

<a id="related-documentation"></a>
## 相关文档

- [招投标子系统](../../docs/subsystems/bid.zh.md)——`ctx.bid` 接缝、`bid/*` 事件与生成的服务 API。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-bid)——模型接收的四个 bid 工具 schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-bid)——bid 服务的每个受支持配置字段。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
