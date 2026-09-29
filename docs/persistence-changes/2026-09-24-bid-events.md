---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-24-bid-events

English | [中文](2026-09-24-bid-events.zh.md)

## Summary

Adds an optional ordered section manifest to persisted bid tender summaries.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing bid/tender-loaded events remain valid because sections is optional. New REST responses always include the manifest, while replay of older events may expose only sectionCount.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/bid --config vitest.config.ts: 58 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
