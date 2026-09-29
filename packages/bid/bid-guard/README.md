---
description: "The bid workflow gate: a tools/pre-execute guard that denies bid_match_capabilities, bid_generate_section, and bid_export until the session's latest parsed tender matches the call's tenderId, for users and maintainers composing or debugging bidding profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-bid-guard

English | [中文](README.zh.md)

## Summary

`dsh-bid-guard` installs one `tools/pre-execute` listener that enforces the bidding workflow order: `bid_match_capabilities`, `bid_generate_section`, and `bid_export` are denied until the session has parsed the tender they target. The gate reads the maintained `bidTender` projection — never the raw event log — so a parse from either the bid tools or the `/bid` command satisfies it and the decision survives resume. A denial returns a model-facing error naming `bid_parse_tender` as the missing first step; every other call delegates unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package beside the tool runtime, the session-projection registry, and `dsh-tool-bid` (which registers the `bidTender` projection this gate reads). It takes no configuration; the gated tool list and the parse-first rule are fixed domain invariants.

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-tool-bid'
- name: '@deepseek-ai/dsh-bid-guard'
```

### When to choose it

Choose it when a bidding profile should refuse out-of-order tool calls deterministically instead of relying on the central service to reject an unparsed `tenderId`. Skip it when the central service's own validation is sufficient: the gate is a fast, local, model-facing refusal, not a security boundary.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the gate; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Projection reads, never history scans.** Synchronous reads of arbitrary session events are deprecated repository-wide; the gate reads the maintained `bidTender` projection through `ctx.sessionProjections.stateOf`, which is resume-safe and O(1).
- **Fail closed.** A missing projection (tool-bid not mounted) or an unparsed tender reads as `null`/`undefined`, which never equals the requested `tenderId`, so the call is denied.
- **Defer what the tool owns.** A call without a `tenderId` argument or without an owning agent session is delegated unchanged, so the tool's own validation produces the more precise error.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the gated-tool list and the single pre-execute listener |
| — | No runtime invariant companion is published because the gate is one listener over the `bidTender` projection and owns no durable state of its own. |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Gate mechanics

For each dispatch the listener checks the tool name against the fixed gated list, reads and trims the frozen `tenderId` argument (matching the gated tools' own `requireField` semantics), resolves the owning agent session, and compares `stateOf(session, 'bidTender')` with the argument. Only an exact match delegates. An unregistered `bidTender` projection denies with a composition-error reason naming `@deepseek-ai/dsh-tool-bid`; a registered projection whose latest tender does not match denies with the workflow reason naming `bid_parse_tender`. Both denials return `{ kind: 'deny', reason }`, which the tool runtime renders as the call's error result.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [bid domain](../bid/README.md) — the `bid/*` events and the `bidTender` projection declaration this gate reads.
- [tool-bid](../tool-bid/README.md) — the tools this gate orders, and the plugin that registers the `bidTender` projection.
- [Bidding subsystem](../../../docs/subsystems/bid.md) — the bid seam, events, and generated service API.

-----

<a id="model-experience"></a>
## Model Experience

### Gate visibility

#### What the model sees

The gate adds no schema and no prompt section. A denied call's tool result becomes `Error: <tool> needs a parsed tender: call bid_parse_tender for tenderId "<id>" first`, which enters the conversation as that call's ordinary error result and tells the model the exact recovering step. Allowed calls are indistinguishable from a composition without the gate.

#### Token effect

Only denials add tokens: one fixed-shape error line per denied call, remaining in history until compaction.

#### KV Cache effect

None; the listener runs at dispatch time and contributes nothing to the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the gate is a poor fit. They are current package constraints, not a task backlog.

- **Requires the `bidTender` projection** — `dsh-tool-bid` registers it; without it every gated call is denied with a composition-error reason (fail-closed), including legitimate ones.
- **Latest-tender semantics** — the projection holds one tender, so the gate allows work only on the most recently parsed tender of that session; earlier tenders deny until re-parsed.
- **Advisory, not a security boundary** — it saves a pointless central-service round trip and steers the model; the central service remains the authoritative validator.
- **Three gated tools** — `bid_parse_tender` is deliberately ungated; deeper ordering (for example, requiring a match before export) is deferred work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above and the package code.

#### Future: richer ordering

Open, undecided: gating `bid_export` on at least one generated section, and a per-tender parsed-set projection so work on any previously parsed tender is allowed. Both would change denial behavior and require new or extended projections.

</details>
