# Bidding

English | [中文](bid.zh.md)

The bid package family integrates tender-to-award bidding into the Harness as a stable seam over a central REST service. The [bid domain](../../packages/bid/bid/README.md) owns the `ctx.bid` client and the `bid/*` Session events and projections; [tool-bid](../../packages/bid/tool-bid/README.md) and [command-bid](../../packages/bid/command-bid/README.md) are the model-facing and human-facing entry points that write those events. Heavy parsing, matching, generation, and export run in the central service, so the Harness surface stays stable as the backend changes.

## Ownership

| Owner | Responsibility |
|---|---|
| [bid](../../packages/bid/bid/README.md) | `ctx.bid`: the HTTP client seam, plus the `bid/*` event and projection declarations |
| [tool-bid](../../packages/bid/tool-bid/README.md) | The four model-facing bidding tools and their `bidTender`/`bidOutline`/`bidMatch` projection units |
| [command-bid](../../packages/bid/command-bid/README.md) | The human `/bid` command over the same seam and events |
| [bid-guard](../../packages/bid/bid-guard/README.md) | Pre-execute gate denying the tender-scoped tools until their tender is parsed |

## Requests and results

`ctx.bid` posts each operation to the central service and returns its typed result: `parseTender` a `BidTender`, `matchCapabilities` a `BidMatch`, `generateSection` a `BidSection`, and `exportBid` a `BidExport`. Every call reads the delegation token from the environment at call time, combines the caller's cancellation with the deployment timeout, accepts only an http/https `apiBaseUrl`, and rejects with the failing status and a truncated body on a non-2xx response.

Each entry point appends the matching `bid/*` event to the owning agent Session, so the `bidTender`, `bidOutline`, and `bidMatch` projections fold the latest state for the UI and a later model request. The command and the tools write identical events; only their trigger differs. State belongs to the one agent session that created it.

[bid-guard](../../packages/bid/bid-guard/README.md) reads the `bidTender` projection on every dispatch and denies a tender-scoped tool call whose `tenderId` the session has not parsed, steering the model back to `bid_parse_tender`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbid--bidservice"></a>

### `ctx.bid` — `BidService`

The HTTP-backed BidClient registered as `ctx.bid`. One process-wide service serves every composition. In static mode each request reads the delegation token from `tokenEnv` at call time, so a rotated token is picked up without a reload. In exchange mode the service trades its service credential for a short-lived delegation token, caches it, and exchanges again before it expires or after the central service rejects it.

```ts cordis-catalog
/**
 * Parse a tender document into its structured summary.
 * @param request - the tender title, filename, exact byte count, and streaming byte source.
 * @param signal - optional caller cancellation combined with the timeout.
 * @returns the parsed tender summary from the central service.
 */
parseTender(request: BidParseTenderRequest, signal?: AbortSignal): Promise<CurrentBidTender>

/**
 * Match the enterprise capability archive against a loaded tender.
 * @param request - the tender identifier to match.
 * @param signal - optional caller cancellation combined with the timeout.
 * @returns the matched/gap counts and risk notes.
 */
async matchCapabilities(request: { tenderId: TenderId }, signal?: AbortSignal): Promise<BidMatch>

/**
 * Generate or revise one technical-bid section.
 * @param request - the tender and section identifiers.
 * @param signal - optional caller cancellation combined with the timeout.
 * @returns the generated section with its status.
 */
async generateSection( request: BidGenerateSectionRequest, signal?: AbortSignal, ): Promise<CurrentBidSection>

/**
 * Export a tender's technical bid to a document artifact.
 * @param request - the tender identifier to export.
 * @param signal - optional caller cancellation combined with the timeout.
 * @returns the produced export artifact descriptor.
 */
async exportBid(request: BidExportRequest, signal?: AbortSignal): Promise<CurrentBidExport>

/**
 * List central bid projects for the global project panel.
 * @param signal - optional caller cancellation.
 * @returns central project summaries in service order.
 */
async listProjects(signal?: AbortSignal): Promise<BidProjectSummary[]>
```

Source: [`packages/bid/bid/src/index.ts`](../../packages/bid/bid/src/index.ts)
<!-- END GENERATED cordis-surface -->
