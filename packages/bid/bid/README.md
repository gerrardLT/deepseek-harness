---
description: "The bid capability seam (ctx.bid): an HTTP client for the central bid REST service plus the bid domain event and projection declarations, for developers and maintainers choosing, composing, or debugging bidding integration."
kind: "package-reference"
---

# @deepseek-ai/dsh-bid

English | [中文](README.zh.md)

## Summary

Use `ctx.bid` to reach the central bid REST service: parse a tender, match capabilities, generate a technical-bid section, and export the finished bid, each over authenticated HTTP with a delegation-JWT bearer. This package also owns the bid domain vocabulary — the `bid/*` session events and the `bidTender`/`bidOutline`/`bidMatch` projections the tools and cards build on. Consumers inject `ctx.bid` instead of fetching themselves, so the base URL, token variable, and timeout are configured once. It registers nothing model-facing; the bid tools own that surface.

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

Use `ctx.bid` when a bidding tool or command needs to reach the central bid REST service. It is the single seam every bid consumer builds on, so the base URL, delegation token, and timeout are configured once rather than per caller. It needs a reachable central service; there is no local fallback, so a call fails when the service is down.

### Minimal configuration

`apiBaseUrl`, `maxTenderBytes`, and `maxExportBytes` are required: a composition that omits one fails at load. `tokenEnv` names the environment variable holding the delegation JWT; `timeoutMs` bounds each request, including the authenticated export download.

```yaml
- id: bid
  name: '@deepseek-ai/dsh-bid'
  config:
    apiBaseUrl: https://bid.internal/api/agent
    tokenEnv: BID_DELEGATION_TOKEN
    maxTenderBytes: 104857600
    maxExportBytes: 104857600
```

| Field | Default | Meaning |
|---|---|---|
| `apiBaseUrl` | required | Base URL (http or https only) of the central bid REST service; a trailing slash is added when absent |
| `tokenEnv` | `BID_DELEGATION_TOKEN` | Environment variable read at call time for the static `Authorization: Bearer` token |
| `serviceTokenEnv` | optional | Environment variable holding the service credential used to exchange for short-lived delegation tokens |
| `delegationSubject` | optional | WorkFusion subject username the exchanged tokens act for; required with `serviceTokenEnv` |
| `timeoutMs` | `1800000` | Per-request timeout in milliseconds; combined with any caller-provided cancellation signal |
| `maxTenderBytes` | required | Inclusive byte cap for a streamed tender upload |
| `maxExportBytes` | required | Inclusive byte cap for the complete downloaded DOCX |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-bid) is the exhaustive source for the accepted fields.

### What each call does

`parseTender`, `matchCapabilities`, and `generateSection` call their service-relative endpoints and validate each complete JSON response. `exportBid` validates the `/export` descriptor, follows only its protected `downloadPath` under `apiBaseUrl` with the same bearer, and streams the bounded DOCX through `ctx.fs` into the current Session workspace. The atomic file write completes before the caller may append `bid/export-produced`, so cancellation, invalid descriptors, oversized bodies, and transfer failures leave neither a partial destination nor a Session event. Every request reads the delegation token from `tokenEnv` at call time, so a rotated token is picked up without a reload.

### Domain vocabulary

The `bid/tender-loaded`, `bid/capability-matched`, `bid/section-generated`, and `bid/export-produced` session events and the `bidTender`, `bidOutline`, and `bidMatch` projections are declared here, their one home. The bid tools append the events and register the projections; this package declares them but registers neither.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the seam; the observable behavior is covered in [Use this package](#use-this-package).

### Design

- **One seam, one configured transport.** `ctx.bid` is a Cordis service; consumers inject it rather than fetching, so the base URL, token, and timeout live in one place.
- **Explicit config, loud failure.** `apiBaseUrl` is required with no default, so a misconfigured composition fails at load instead of calling a wrong URL.
- **Token read at call time.** The delegation JWT is read from `tokenEnv` per request, so rotation needs no reload.
- **A stable contract over a swappable transport.** The `BidClient` interface is the contract; the HTTP implementation can change without touching consumers.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `BidService` (default export): the `ctx.bid` HTTP client, its `Config`, and the `Context.bid` augmentation |
| [`src/types.ts`](src/types.ts) | The one home of the bid domain types, the `bid/*` event and projection declarations, and the `BidClient` contract |
| [`src/client.ts`](src/client.ts) | Client-namespace re-export of the types outlet |
| — | No runtime invariant companion is published because this package appends no session event of its own; the bid tools that append `bid/*` events own any durable-shape invariant once untrusted service data reaches the log. |

### Export shape

The package's default export is the `BidService` class, loaded as a Cordis service rather than a name/inject/apply namespace plugin. Loading it registers `ctx.bid`; the `Context.bid` type comes from the augmentation in [src/index.ts](src/index.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [tool-bid](../tool-bid/README.md) — the model-facing bid tools over this seam.
- [Session projection](../../session/session-projection/README.md) — the carrier for the `bidTender`/`bidOutline`/`bidMatch` projections declared here.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-bid) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the bid tools that inject `ctx.bid`; the seam registers no prompt, schema, or result text of its own.

#### KV Cache effect

No direct invalidation; the consuming bid tools own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the seam does not provide. They are current package constraints, not a roadmap.

- **Requires a reachable central service** — there is no local fallback; a call fails when the central bid REST service is down.
- **Four operations only** — parse, match, generate, and export; review and knowledge-search arrive in later phases.
- **One delegation token per composition** — read from a single environment variable; per-user or per-task token minting is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open, undecided: per-request delegation scoping (minting a task-scoped JWT per call rather than one shared token) and streaming progress for long generate and export calls. Both are deferred until the central REST endpoints exist.

</details>
