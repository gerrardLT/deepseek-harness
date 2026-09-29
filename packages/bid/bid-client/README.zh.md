---
description: "浏览中心投标项目、重新打开关联会话，并以对话卡片阅读持久化的招标文件、匹配、章节和导出结果。"
kind: "package-reference"
---
# @deepseek-ai/dsh-bid-client

[English](README.md) | 中文

## 概述

从全局面板浏览中心投标项目，重新打开各项目关联的会话，并以对话卡片阅读持久化投标结果。仅在投标专用 Web 组合中选择本包。浏览器只通过 Host Remote 访问中心 Python 服务，绝不直接连接。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

发布的 `bid-web` profile 会连同 Host 和浏览器依赖一起挂载本包。

### 何时选择

投标专用 Web 应用需要跨会话项目导航和持久化结果卡片时选择本包。通用 Web 组合应省略本包。

### 最小配置

请在 `@deepseek-ai/dsh-bid` 和 Typert 服务之后挂载 `@deepseek-ai/dsh-bid-client`。本包没有配置字段。生成的[配置目录](../../../docs/config-catalog.zh.md)是所有接受字段的完整来源。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部结构——点击展开</summary>

Host 通过生成的 `bidProjects` Remote 命名空间公开中心项目摘要。浏览器注册一个全局面板、一个侧栏入口和可重放的对话卡片；每项注册都随所属 Cordis fiber 卸载。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [投标产品需求](../PRODUCT.md)
- [配置目录](../../../docs/config-catalog.zh.md)
- [Cordis 入门](../../../docs/cordis-primer.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只渲染中心项目和持久化会话状态，不贡献模型可见输入。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

当前面板使用请求式项目发现。

- 项目列表在全局面板挂载时刷新；中心项目的实时更新需要推送式 Remote feed。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
