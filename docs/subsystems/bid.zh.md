# 招投标

[English](bid.md) | 中文

bid 包族把"招标到中标"的招投标能力作为一个稳定接缝融入 Harness，底层是中心 REST 服务。[bid 领域](../../packages/bid/bid/README.zh.md)拥有 `ctx.bid` 客户端以及 `bid/*` 会话事件与投影；[tool-bid](../../packages/bid/tool-bid/README.zh.md) 与 [command-bid](../../packages/bid/command-bid/README.zh.md) 是写入这些事件的模型入口与人类入口。繁重的解析、匹配、生成与导出在中心服务运行，因此后端变化时 Harness 表面保持稳定。

## 归属

| 所有者 | 职责 |
|---|---|
| [bid](../../packages/bid/bid/README.zh.md) | `ctx.bid`：HTTP 客户端接缝，以及 `bid/*` 事件与投影声明 |
| [tool-bid](../../packages/bid/tool-bid/README.zh.md) | 四个面向模型的招投标工具及其 `bidTender`/`bidOutline`/`bidMatch` 投影单元 |
| [command-bid](../../packages/bid/command-bid/README.zh.md) | 基于同一接缝与事件的人类 `/bid` 命令 |
| [bid-guard](../../packages/bid/bid-guard/README.zh.md) | pre-execute 门禁：招标解析前拒绝面向招标的工具 |

## 请求与结果

`ctx.bid` 把每个操作 post 给中心服务并返回其带类型的结果：`parseTender` 返回 `BidTender`、`matchCapabilities` 返回 `BidMatch`、`generateSection` 返回 `BidSection`、`exportBid` 返回 `BidExport`。每次调用在调用时从环境读取委托 token，把调用方取消与部署超时组合，只接受 http/https 的 `apiBaseUrl`，并在非 2xx 响应时以失败状态码与截断响应体拒绝。

每个入口把匹配的 `bid/*` 事件追加到所有者 agent 会话，因此 `bidTender`、`bidOutline`、`bidMatch` 投影为 UI 与后续模型请求折叠出最新状态。命令与工具写入相同的事件；只有触发方不同。状态归属创建它的那一个 agent 会话。

[bid-guard](../../packages/bid/bid-guard/README.zh.md) 在每次派发时读取 `bidTender` 投影，拒绝其 `tenderId` 尚未被本会话解析的招标作用域工具调用，把模型引导回 `bid_parse_tender`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbid--bidservice"></a>

### `ctx.bid` — `BidService`

The HTTP-backed BidClient registered as `ctx.bid`. One process-wide service serves every composition; each request reads the delegation token from the configured environment variable at call time, so a rotated token is picked up without a reload.

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
