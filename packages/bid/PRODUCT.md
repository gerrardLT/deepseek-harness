# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

企业投标编制人员在 Windows DSH 中完成招标文件解析、能力匹配、技术标章节生成、项目进度跟踪和交付物导出。

## Product Purpose

把一次投标从招标文件到技术标交付物的工作集中到 DSH 对话中。成功意味着用户能从跨会话项目列表找到一份投标，进入对应会话，识别未完成章节并继续工作，而不需要返回旧 bid 前端。

## Positioning

“对话即工作台”：项目、章节进度和执行对话保持可导航关联，后台任务及中心服务状态在同一个原生 DSH 工作流中呈现。

## Operating Context

用户在 Windows 桌面端或本机 Web GUI 中工作。招标文件来自本机工作区，章节生成可在后台运行；中心 WorkFusion Python 服务持有跨会话项目和持久进度，DSH Session 持有模型可见的过程与结果事件。

## Capabilities and Constraints

- 中心 Python 服务是跨会话项目列表和项目进度的事实源。
- 浏览器不得直接访问 Python 服务；所有项目查询通过 DSH Host。
- 项目面板位于现有右侧 Sidebar，能够跳转到或继续对应 Session。
- 当前一期覆盖解析、匹配、单章节与整份生成、项目进度和 DOCX 导出。
- 旧 bid 前端直接下线，不提供回退入口，也不导入旧数据。
- 部署选项通过配置注入，不硬编码可调参数。

## Brand Commitments

产品沿用 DeepSeek Harness 的原生 Client 组件、语义设计 token 和桌面交互。面向用户的新增文案以简体中文为第一语言，并由类型化 locale 字典持有。

## Evidence on Hand

- DSH 的 `bid/*` Session 事件与 `bidTender`、`bidOutline`、`bidMatch` 投影。
- `ctx.jobs` 与 `ctx.subagents` 整份标书后台编排。
- WorkFusion 中现有招投标业务服务、Celery、PostgreSQL、Redis、pgvector、OCR 和 Word 排版能力。
- 当前没有可引用的客户证言、量化效率数据或品牌图像资产；后续界面不得虚构这些内容。

## Product Principles

- 用户始终能看见当前项目、当前章节状态和下一步动作。
- 对话、后台任务和项目事实使用明确的身份关联，不跨项目混合状态。
- 持久进度来自中心服务，模型可见过程来自 Session 日志。
- 长任务可离开页面后继续，回到项目时能够恢复工作上下文。
- 中心服务故障、鉴权缺失和数据不一致应明确失败，不静默降级。

## Accessibility & Inclusion

键盘操作、可见焦点、语义化状态文本和浅色／深色主题均沿用 DSH Client 的现有无障碍约束；状态不能仅依赖颜色表达。
