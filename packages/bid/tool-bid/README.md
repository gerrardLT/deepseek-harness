---
description: "The model-facing bidding tools over the DeepSeek Harness session log: parse, capability-match, section-generation, and export, each a durable bid/* event with the bidTender/bidOutline/bidMatch projections, for users and maintainers choosing, composing, or debugging the tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-bid

English | [中文](README.zh.md)

## Summary

`dsh-tool-bid` gives the agent four native bidding tools over the session log: `bid_parse_tender`, `bid_match_capabilities`, `bid_generate_section`, and `bid_export`. Each delegates to the central bid REST service through the `ctx.bid` seam and appends a durable `bid/*` event; the `bidTender`, `bidOutline`, and `bidMatch` projections serve the latest state to the UI. It is the bidding system's native integration into DeepSeek Harness: the tool names, events, projections, and cards stay stable across backend changes. Each tool is owned by the one agent session that calls it.

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

Use this package when an agent should carry out bidding work inside its session: load a tender, match the enterprise archive against it, draft its technical-bid sections, and export the finished document. Mounting it beside the tool runtime, the session-projection registry, and the `ctx.bid` REST seam is the only setup; the agent then calls the tools in that order.

### When to choose it

Choose it when one agent session should own the bidding state and whole-value replacement per key is fine — the common shape for load-then-work tools. Avoid it when several agents must share one loaded tender or when you need incremental field edits: the state belongs to one agent, and each event replaces its projection value. Every tool needs an agent session; automation-only surfaces that never run an agent cannot use them.

### Mount it

The tools take no configuration of their own; they inject the `ctx.bid` REST seam, so mount that first with its `apiBaseUrl`:

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
- name: '@deepseek-ai/dsh-tool-bid'
```

The `apiBaseUrl` and delegation token are configured on [`@deepseek-ai/dsh-bid`](../bid/README.md); each tool sends its trimmed arguments to the matching `ctx.bid` method and records whatever it returns.

### What each tool does

| Tool | Sends to `ctx.bid` | Appends event | Folds into |
|---|---|---|---|
| `bid_parse_tender` | `parseTender({ path, title })` | `bid/tender-loaded` | `bidTender` |
| `bid_match_capabilities` | `matchCapabilities({ tenderId })` | `bid/capability-matched` | `bidMatch` |
| `bid_generate_section` | `generateSection({ tenderId, sectionId })` | `bid/section-generated` | `bidOutline` (upsert by sectionId) |
| `bid_export` | `exportBid({ tenderId })` | `bid/export-produced` | — (result only) |

Each call trims and rejects empty required fields before the REST call, so a malformed argument fails visibly without a round trip or a durable write.

### Single owner

The bidding state belongs to the one agent session that created it — subagents and other agents each keep their own, and there is no way to share it between agents. A call from outside an agent session is rejected, so the agent learns the call failed instead of silently writing nowhere.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The tools are built on three commitments:

- **Log-backed state.** Each `bid/*` snapshot lives on the event-sourced session log, so durability, replay, and resume reconstruction come from the log rather than a service.
- **Single owner.** The state belongs to the calling agent session; there is no shared scope, and non-agent callers are rejected.
- **A stable seam over a swappable backend.** The tool names, events, projections, and cards are the durable contract; the work is delegated to the central bid REST service through `ctx.bid`, so the backend can change without touching what the model or UI sees.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the four tool registrations, the `bidTender`/`bidOutline`/`bidMatch` projection units, and the shared `agentSession`/`requireField` validation helpers |
| [`src/types.ts`](src/types.ts) | Re-export of the `BidTender`/`BidSection`/`BidMatch`/`BidExport` payload types from `@deepseek-ai/dsh-bid`; the event and projection declarations live in that domain package |
| [`src/client.ts`](src/client.ts) | Client-namespace re-export of the types outlet |
| — | No runtime invariant companion is published because the `@deepseek-ai/dsh-bid` domain owns the `bid/*` vocabulary and will carry any durable-shape invariant once untrusted REST-sourced data flows in production. |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Session projections

When the composition mounts `ctx.sessionProjections` ([`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)), this package registers three units on an injected child: `bidTender` (latest `bid/tender-loaded`), `bidMatch` (latest `bid/capability-matched`), and `bidOutline` (every `bid/section-generated`, latest per `sectionId`, order-preserving). Each is `null` before its first event and unchanged by unrelated events. The keys merge into `SessionProjectionMap` in the domain package; see [src/index.ts](src/index.ts) for the unit registrations.

### Call mechanics

Each call resolves the owning session, trims and validates its required fields, awaits the matching `ctx.bid` method, appends the returned payload as a `bid/*` session event, and returns the rendered text; the current value is always the most recent matching event in the log (last-write-wins on replay). See [src/index.ts](src/index.ts) for the exact steps.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the REST seam and session projection to the generated catalog.

- [bid domain](../bid/README.md) — the `ctx.bid` REST seam and the `bid/*` event and projection declarations these tools consume.
- [Session projection](../../session/session-projection/README.md) — the `bidTender`/`bidOutline`/`bidMatch` projection carrier and its wire frame.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bid) — the four tool schemas the model receives.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees four generated schemas under [`@deepseek-ai/dsh-tool-bid`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bid): `bid_parse_tender` (`path`, `title`), `bid_match_capabilities` (`tenderId`), `bid_generate_section` (`tenderId`, `sectionId`), and `bid_export` (`tenderId`), all required strings. Each description states when to call it in the parse-then-match-then-generate-then-export order.

#### Token effect

Fixed schema cost for all four on every request where the tools are visible; the descriptions and schemas are stable.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains its arguments. Success returns one fixed-shape line per tool — `Loaded tender ...`, `Matched N requirements, M gaps ...`, `Generated section ...`, `Started whole-bid generation job ...`, or `Exported bid to ...`. Stable failures are `Error: invalid <domain>: \`<field>\` must be a non-empty string`, `Error: <tool> requires an owning agent session`, and a central-service failure `Error: bid REST <path> failed with status <code>`. The full `bid/*` session events are UI and replay state, not second model messages.

#### Token effect

Token growth scales with the call arguments, which remain until compaction. Each result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Requires the bid REST seam** — the tools inject `ctx.bid`; a composition without `@deepseek-ai/dsh-bid` mounted cannot load them, and a call fails when the central service is unreachable.
- **Single-owner scope only** — the bidding state belongs to the one calling agent session; shared and cross-agent scopes are a deliberate cut, and a non-agent caller is rejected.
- **Whole-value replacement per key** — no incremental field edits and no read-back tool; `bidOutline` upserts whole sections by `sectionId`, and the other projections replace wholesale.
- **Process-local job status** — `bid_generate_bid` runs as an owner-scoped `ctx.jobs` task; deployments using `jobs-local` lose its job record on process restart, while durable section results remain in the parent Session and central service.
- **Manifest required for whole-bid generation** — legacy tender events without `sections` remain replayable but cannot start `bid_generate_bid`; parse the tender again to obtain a current manifest.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above and the package code.

#### Future: independent bid review

Open, undecided: a review tool once the central service exposes the evaluation pipeline. It would add review events and projections and change the model-visible tool set.

</details>
