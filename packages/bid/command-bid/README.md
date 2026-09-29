---
description: "The human /bid slash command over the DeepSeek Harness session log: parse, match, generate, and export subcommands that run one tender/bid operation directly through the ctx.bid seam and append the same bid/* event the tools write, for users and maintainers choosing, composing, or debugging the command."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-bid

English | [中文](README.zh.md)

## Summary

`dsh-command-bid` registers the human `/bid` slash command: `parse`, `match`, `generate`, and `export` subcommands that run one tender/bid operation directly against the central bid REST service through the `ctx.bid` seam, without a model turn. Each subcommand appends the same durable `bid/*` event the `dsh-tool-bid` tools write and returns its sequence as the result's `sourceEventSeq`, so the `bidTender`/`bidOutline`/`bidMatch` projection cards update exactly as they do after a tool call. It is the deterministic human entry point beside the model-invoked tools.

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

Use this package when a human should drive one bidding step deterministically from the composer — parse a tender, match capabilities, generate a section, or export — without asking the model to choose a tool. Mounting it beside the command registry and the `ctx.bid` REST seam is the only setup; the user then types `/bid <subcommand> <args>`.

### When to choose it

Choose it for a direct, no-model-turn action whose arguments the user already knows. Choose the `dsh-tool-bid` tools instead when the model should decide the step from natural language. Both entry points write the same `bid/*` events, so the resulting session state and cards are identical regardless of which one ran.

### Mount it

The command takes no configuration of its own; it injects the `ctx.bid` REST seam, so mount that first with its `apiBaseUrl`:

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
- name: '@deepseek-ai/dsh-command-bid'
```

The `apiBaseUrl` and delegation token are configured on [`@deepseek-ai/dsh-bid`](../bid/README.md).

### What each subcommand does

| Subcommand | Arguments | Sends to `ctx.bid` | Appends event |
|---|---|---|---|
| `/bid parse` | `<path> <title…>` | `parseTender({ path, title })` | `bid/tender-loaded` |
| `/bid match` | `<tenderId>` | `matchCapabilities({ tenderId })` | `bid/capability-matched` |
| `/bid generate` | `<tenderId> <sectionId>` | `generateSection({ tenderId, sectionId })` | `bid/section-generated` |
| `/bid export` | `<tenderId>` | `exportBid({ tenderId })` | `bid/export-produced` |

Arguments are whitespace-delimited; `parse` joins every token after the path into the title. A missing required argument returns the usage line as an error result without a REST round trip, and a central-service failure returns its message as an error result rather than rejecting the dispatch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the command; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One seam, two entry points.** The command and the `dsh-tool-bid` tools both call `ctx.bid` and append the same `bid/*` events, so the human and model surfaces converge on one durable state.
- **Fail inline.** Argument and central-service failures return a `kind: 'error'` result the composer renders, never a rejected dispatch.
- **Quiesce on teardown.** The registration is an effect that drains in-flight operations before unregistering, so a teardown cannot strand a long `generate`/`export` call.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `/bid` registration, the subcommand dispatch, and the teardown drain |
| — | No runtime invariant companion is published because the `@deepseek-ai/dsh-bid` domain owns the `bid/*` vocabulary and this command only re-emits it. |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Result and event pairing

A successful subcommand returns `{ kind: 'success', text, sourceEventSeq }`, where `sourceEventSeq` is the sequence of the `bid/*` event it just appended. A dispatching surface uses that sequence to render the richer projection card instead of the plain text, exactly as it does for the tools' events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [bid domain](../bid/README.md) — the `ctx.bid` REST seam and the `bid/*` event and projection declarations this command re-emits.
- [tool-bid](../tool-bid/README.md) — the model-invoked tools that write the same events from natural language.
- [commands](../../interaction/commands/README.md) — the command registry, `CommandInvocation`, and `CommandResult` this package registers against.

-----

<a id="model-experience"></a>
## Model Experience

### The /bid invocation

#### What the model sees

Nothing. `/bid` is a human command: the dispatcher logs `command/run` and `command/done`, which are log-only and never reach a model request. The model is offered no `/bid` schema and never chooses to run it.

#### Token effect

No model-request tokens; the command bypasses the model entirely.

#### KV Cache effect

None from the invocation itself.

### The appended bid/* events

#### What the model sees

Each subcommand appends the same `bid/tender-loaded`, `bid/capability-matched`, `bid/section-generated`, or `bid/export-produced` event the `dsh-tool-bid` tools write. A later model request reconstructs the tender, match, outline, and export state through the `bidTender`, `bidOutline`, and `bidMatch` projections exactly as it would after a tool call, so the human and model entry points leave identical model-visible state.

#### Token effect

The appended events reach a request only through the projections they fold into, matching the tools' cost.

#### KV Cache effect

Append-only; the events follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the command is a poor fit. They are current package constraints, not a task backlog.

- **Requires the command registry and the bid REST seam** — the command injects `ctx.commands` and `ctx.bid`; a composition without `@deepseek-ai/dsh-commands` and `@deepseek-ai/dsh-bid` mounted cannot load it, and a subcommand fails when the central service is unreachable.
- **Long operations block the command turn** — `generate` and `export` await the central service inline; a `ctx.jobs` background orchestration for whole-bid generation is deferred work.
- **Whitespace-delimited arguments** — the `parse` path must be a single token (only the title may contain spaces), and no quoting or flag grammar is supported.
- **Single-owner scope** — the events append to the invoking agent's own session, matching the tools' single-owner state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
