---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-24-bid-events

[English](2026-09-24-bid-events.md) | 中文

## 概述

为持久化的招标摘要增加可选的有序章节清单。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-24-bid-events
baseline: false
changes:
  - root: "event:bid/capability-matched"
    previous: null
    after: "0d05a662fb3ccd43e2808af1f667074a948d3fe1f96006f34bc9d6455e3388b1"
    decision: same-version
  - root: "event:bid/export-produced"
    previous: null
    after: "5867439a7bd348e88d13c3ee4fc2b6ad42056d92becb58d023c5518cb2c8430e"
    decision: same-version
  - root: "event:bid/section-generated"
    previous: null
    after: "0cbe66b61baca9854af52743bf036b189b0ed0836ea2306b3e00254f710bb4c5"
    decision: same-version
  - root: "event:bid/tender-loaded"
    previous: null
    after: "c91c532896155b606dc8c1a10f23ea8426e64a34418b76ab339952d8cbb55fb7"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 bid/tender-loaded 事件仍然有效，因为 sections 为可选字段。新的 REST 响应始终包含章节清单，回放旧事件时可能只有 sectionCount。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/bid --config vitest.config.ts：58 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
