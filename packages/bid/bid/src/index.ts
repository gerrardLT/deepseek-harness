/**
 * The bid capability seam (`ctx.bid`): an HTTP-backed client for the central
 * bid REST service. It owns the delegation-JWT bearer and the per-request
 * timeout so tool and command consumers inject one shared client instead of
 * performing their own fetch. The domain event and projection declarations live
 * in `./types.ts`; this entry projects that type face onto the package root and
 * keeps the module edge in the emitted index.d.ts, so aggregate consumers
 * receive the SessionEventMap and SessionProjectionMap merges.
 * @module @deepseek-ai/dsh-bid
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type {
  BidClient,
  BidExportId,
  BidExportRequest,
  BidGenerateSectionRequest,
  BidMatch,
  BidParseTenderRequest,
  BidProjectSummary,
  CurrentBidExport,
  CurrentBidSection,
  CurrentBidTender,
  SectionId,
  TenderId,
} from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bid: BidService
  }
}

/** Deployment configuration for the central bid REST client. */
export interface Config {
  /** Base URL of the central bid REST service; a trailing slash is added when absent. */
  apiBaseUrl: string
  /** Environment variable holding a static delegation JWT; ignored in exchange mode. */
  tokenEnv?: string
  /**
   * Exchange mode: environment variable holding the runtime's service credential.
   * When set with `delegationSubject`, the client obtains short-lived delegation
   * JWTs from the central `delegation` endpoint instead of reading `tokenEnv`.
   */
  serviceTokenEnv?: string
  /** Central-service username the exchanged tokens act for; required with `serviceTokenEnv`. */
  delegationSubject?: string
  /** Per-request timeout in milliseconds for long parse/generate/export calls. */
  timeoutMs?: number
  /** Maximum accepted tender upload size in bytes. */
  maxTenderBytes: number
  /** Maximum downloaded DOCX export size in bytes. */
  maxExportBytes: number
}

/** Default environment variable carrying the delegation JWT. */
const DEFAULT_TOKEN_ENV = 'BID_DELEGATION_TOKEN'
/** Default per-request timeout: 30 minutes, matching the long tender/section jobs. */
const DEFAULT_TIMEOUT_MS = 1_800_000
/** Only HTTP(S) endpoints may carry commercial-secret tender traffic. */
const ALLOWED_PROTOCOLS = ['http:', 'https:']

/** Read one required credential from the environment, rejecting an absent or empty value. */
function readEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`bid: token environment variable ${name} must have a nonempty value`)
  }
  return value
}

const tenderIdSchema = zod.string().min(1).transform(value => brandString<TenderId>(value))
const sectionIdSchema = zod.string().min(1).transform(value => brandString<SectionId>(value))
const exportIdSchema = zod.string().min(1).transform(value => brandString<BidExportId>(value))
const tenderSectionRefSchema = zod.object({
  sectionId: sectionIdSchema,
  title: zod.string(),
}).strict()
const tenderSchema: ZodType<CurrentBidTender> = zod.object({
  tenderId: tenderIdSchema,
  title: zod.string(),
  sections: zod.array(tenderSectionRefSchema),
  sectionCount: zod.number().int().nonnegative(),
}).strict().refine(tender => tender.sectionCount === tender.sections.length, 'sectionCount must equal sections.length')
const matchSchema: ZodType<BidMatch> = zod.object({
  tenderId: tenderIdSchema,
  matched: zod.number().int().nonnegative(),
  gaps: zod.number().int().nonnegative(),
  risks: zod.array(zod.string()),
}).strict()
const sectionSchema: ZodType<CurrentBidSection> = zod.object({
  tenderId: tenderIdSchema,
  sectionId: sectionIdSchema,
  title: zod.string(),
  status: zod.enum(['draft', 'reviewed', 'final']),
}).strict()
const projectSchema: ZodType<BidProjectSummary> = zod.object({
  projectId: zod.string().min(1),
  title: zod.string(),
  sessionId: zod.string().min(1).transform(value => brandString<import('@deepseek-ai/dsh-session/types').SessionId>(value)).optional(),
  status: zod.union([
    zod.literal('parsed'), zod.literal('matching'), zod.literal('generating'),
    zod.literal('ready'), zod.literal('exported'), zod.literal('failed'),
  ]),
  completedSections: zod.number().int().nonnegative(),
  totalSections: zod.number().int().nonnegative(),
  updatedAt: zod.iso.datetime(),
})
const projectsSchema: ZodType<BidProjectSummary[]> = zod.array(projectSchema)

const exportDescriptorSchema = zod.object({
  tenderId: tenderIdSchema,
  exportId: exportIdSchema,
  downloadPath: zod.string().min(1),
  pages: zod.number().int().nonnegative(),
}).strict()

const delegationGrantSchema = zod.object({
  token: zod.string().min(1),
  scopes: zod.array(zod.string()),
  expiresIn: zod.number().int().positive(),
  issuedAt: zod.number().int(),
}).strict()

/** Scopes requested in exchange mode; the central service grants their intersection with the subject's permissions. */
const DELEGATION_SCOPES = ['bid:read', 'bid:create', 'bid:update', 'bid:export']
/** Exchanged tokens are refreshed this long before expiry so an in-flight request never carries an expired token. */
const DELEGATION_REFRESH_MARGIN_MS = 60_000

/**
 * The HTTP-backed {@link BidClient} registered as `ctx.bid`. One process-wide
 * service serves every composition. In static mode each request reads the
 * delegation token from `tokenEnv` at call time, so a rotated token is picked up
 * without a reload. In exchange mode the service trades its service credential
 * for a short-lived delegation token, caches it, and exchanges again before it
 * expires or after the central service rejects it.
 */
export default class BidService extends Service implements BidClient {
  static inject = ['fs']
  static Config: z<Config> = z.object({
    apiBaseUrl: z.string().required(),
    tokenEnv: z.string().default(DEFAULT_TOKEN_ENV),
    serviceTokenEnv: z.string(),
    delegationSubject: z.string(),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    maxTenderBytes: z.number().required(),
    maxExportBytes: z.number().required(),
  })

  private readonly apiBaseUrl: string
  private readonly tokenEnv: string
  private readonly exchange: { serviceTokenEnv: string; subject: string } | undefined
  private readonly timeoutMs: number
  private readonly maxTenderBytes: number
  private readonly maxExportBytes: number
  private grant: { token: string; refreshAt: number } | undefined
  private pendingGrant: Promise<string> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'bid')
    // Schemastery validates and fills every default before construction.
    const resolved = config as Required<Config>
    // Fail loud at load on a malformed or non-HTTP(S) base URL: tender traffic
    // is commercial-secret, so only http/https endpoints are accepted.
    const protocol = new URL(resolved.apiBaseUrl).protocol
    if (!ALLOWED_PROTOCOLS.includes(protocol)) {
      throw new Error(`bid: apiBaseUrl must use http or https, got ${protocol}`)
    }
    // `new URL(relative, base)` drops the base's last path segment unless the
    // base ends in a slash, so normalize once here rather than per request.
    this.apiBaseUrl = resolved.apiBaseUrl.endsWith('/') ? resolved.apiBaseUrl : `${resolved.apiBaseUrl}/`
    this.tokenEnv = resolved.tokenEnv
    const serviceTokenEnv = config.serviceTokenEnv?.trim() || undefined
    const subject = config.delegationSubject?.trim() || undefined
    if ((serviceTokenEnv === undefined) !== (subject === undefined)) {
      throw new Error('bid: serviceTokenEnv and delegationSubject must be configured together')
    }
    this.exchange = serviceTokenEnv === undefined || subject === undefined ? undefined : { serviceTokenEnv, subject }
    // Fail loud at load when the credential this mode depends on is absent.
    readEnv(this.exchange?.serviceTokenEnv ?? this.tokenEnv)
    if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
      throw new Error('bid: timeoutMs must be a positive safe integer')
    }
    this.timeoutMs = resolved.timeoutMs
    if (!Number.isSafeInteger(resolved.maxTenderBytes) || resolved.maxTenderBytes <= 0) {
      throw new Error('bid: maxTenderBytes must be a positive safe integer')
    }
    this.maxTenderBytes = resolved.maxTenderBytes
    if (!Number.isSafeInteger(resolved.maxExportBytes) || resolved.maxExportBytes <= 0) {
      throw new Error('bid: maxExportBytes must be a positive safe integer')
    }
    this.maxExportBytes = resolved.maxExportBytes
  }

  /**
   * Parse a tender document into its structured summary.
   * @param request - the tender title, filename, exact byte count, and streaming byte source.
   * @param signal - optional caller cancellation combined with the timeout.
   * @returns the parsed tender summary from the central service.
   */
  parseTender(request: BidParseTenderRequest, signal?: AbortSignal): Promise<CurrentBidTender> {
    if (!Number.isSafeInteger(request.bytes) || request.bytes < 0) {
      return Promise.reject(new Error('bid: tender bytes must be a nonnegative safe integer'))
    }
    if (request.bytes > this.maxTenderBytes) {
      return Promise.reject(new Error(`bid: tender exceeds maxTenderBytes (${this.maxTenderBytes})`))
    }
    const path = new URL('tenders/parse', this.apiBaseUrl)
    path.searchParams.set('title', request.title)
    path.searchParams.set('name', request.name)
    if (request.sessionId !== undefined) {
      path.searchParams.set('sessionId', request.sessionId)
    }
    return this.postStream(path, request, tenderSchema, signal)
  }

  /**
   * Match the enterprise capability archive against a loaded tender.
   * @param request - the tender identifier to match.
   * @param signal - optional caller cancellation combined with the timeout.
   * @returns the matched/gap counts and risk notes.
   */
  async matchCapabilities(request: { tenderId: TenderId }, signal?: AbortSignal): Promise<BidMatch> {
    const match = await this.post('match', request, matchSchema, signal)
    if (match.tenderId !== request.tenderId) throw new Error('bid REST match returned a different tenderId')
    return match
  }

  /**
   * Generate or revise one technical-bid section.
   * @param request - the tender and section identifiers.
   * @param signal - optional caller cancellation combined with the timeout.
   * @returns the generated section with its status.
   */
  async generateSection(
    request: BidGenerateSectionRequest,
    signal?: AbortSignal,
  ): Promise<CurrentBidSection> {
    const section = await this.post('sections/generate', request, sectionSchema, signal)
    if (section.tenderId !== request.tenderId || section.sectionId !== request.sectionId) {
      throw new Error('bid REST sections/generate returned different tender or section identity')
    }
    return section
  }

  /**
   * Export a tender's technical bid to a document artifact.
   * @param request - the tender identifier to export.
   * @param signal - optional caller cancellation combined with the timeout.
   * @returns the produced export artifact descriptor.
   */
  async exportBid(request: BidExportRequest, signal?: AbortSignal): Promise<CurrentBidExport> {
    const descriptor = await this.post('export', { tenderId: request.tenderId }, exportDescriptorSchema, signal)
    if (descriptor.tenderId !== request.tenderId) throw new Error('bid REST export returned a different tenderId')
    const downloadUrl = new URL(descriptor.downloadPath, this.apiBaseUrl)
    const apiUrl = new URL(this.apiBaseUrl)
    const apiPath = apiUrl.pathname.endsWith('/') ? apiUrl.pathname : `${apiUrl.pathname}/`
    if (downloadUrl.origin !== apiUrl.origin || !downloadUrl.pathname.startsWith(apiPath)) {
      throw new Error('bid REST export returned a downloadPath outside apiBaseUrl')
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(downloadUrl, {
      headers: { authorization: `Bearer ${await this.bearer(combined)}` },
      signal: combined,
    })
    if (!response.ok) {
      this.forgetRejectedGrant(response.status)
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`bid REST export download failed with status ${response.status}: ${detail}`)
    }
    const contentLength = response.headers.get('content-length')
    const expectedBytes = contentLength === null ? undefined : Number(contentLength)
    if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
      throw new Error('bid REST export download returned an invalid content-length')
    }
    if (expectedBytes !== undefined && expectedBytes > this.maxExportBytes) {
      throw new Error(`bid REST export download exceeds maxExportBytes (${this.maxExportBytes})`)
    }
    const body = response.body
    if (body === null) throw new Error('bid REST export download returned no body')
    const workspaceRoot = request.session.header.cwd
    if (workspaceRoot === undefined) throw new Error('bid export requires a Session workspace')
    const target = await this.ctx.fs.resolve(request.destination, { cwd: workspaceRoot, signal: combined })
    const data = (async function* (): AsyncIterable<Uint8Array> {
      const reader = body.getReader()
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) return
          yield next.value
        }
      } finally {
        reader.releaseLock()
      }
    })()
    await this.ctx.fs.writeByteStream(target, {
      data,
      maxBytes: this.maxExportBytes,
      ...(expectedBytes === undefined ? {} : { expectedBytes }),
    }, { kind: 'createIfAbsent' }, combined, {
      mode: 'workspace-write',
      workspaceRoot,
      sessionId: request.session.id,
    })
    return { tenderId: descriptor.tenderId, exportId: descriptor.exportId, docxPath: request.destination, pages: descriptor.pages }
  }

  /**
   * List central bid projects for the global project panel.
   * @param signal - optional caller cancellation.
   * @returns central project summaries in service order.
   */
  async listProjects(signal?: AbortSignal): Promise<BidProjectSummary[]> {
    return this.get('projects', projectsSchema, signal)
  }

  private async get<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, ...(signal === undefined ? [] : [signal])])
    const timer = setTimeout(() => { controller.abort(new Error(`bid REST ${path} timed out`)) }, this.timeoutMs)
    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        method: 'GET', headers: { authorization: `Bearer ${await this.bearer(combined)}` }, signal: combined,
      })
      return await this.decodeResponse(path, response, schema)
    } finally {
      clearTimeout(timer)
    }
  }

  private async postStream<T>(
    url: URL,
    request: BidParseTenderRequest,
    schema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const iterator = request.data[Symbol.asyncIterator]()
    let transferred = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) {
          if (transferred !== request.bytes) controller.error(new Error(`bid: tender stream ended at ${transferred} bytes, expected ${request.bytes}`))
          else controller.close()
          return
        }
        transferred += next.value.byteLength
        if (transferred > request.bytes) {
          controller.error(new Error(`bid: tender stream exceeded declared length ${request.bytes}`))
          return
        }
        controller.enqueue(next.value)
      },
      cancel(reason) {
        return iterator.return?.(reason).then(() => undefined)
      },
    })
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(request.bytes),
        authorization: `Bearer ${await this.bearer(combined)}`,
      },
      body,
      duplex: 'half',
      signal: combined,
    }
    const response = await fetch(url, init)
    return this.decodeResponse('tenders/parse', response, schema)
  }

  /**
   * Resolve the Bearer token for one request: the static `tokenEnv` value, or a
   * cached exchanged token refreshed before expiry. Concurrent callers share one
   * in-flight exchange.
   */
  private async bearer(signal?: AbortSignal): Promise<string> {
    if (this.exchange === undefined) return readEnv(this.tokenEnv)
    if (this.grant !== undefined && Date.now() < this.grant.refreshAt) return this.grant.token
    this.pendingGrant ??= this.exchangeGrant(this.exchange, signal).finally(() => { this.pendingGrant = undefined })
    return this.pendingGrant
  }

  private async exchangeGrant(exchange: { serviceTokenEnv: string; subject: string }, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const response = await fetch(new URL('delegation', this.apiBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-service-token': readEnv(exchange.serviceTokenEnv) },
      body: JSON.stringify({ subject: exchange.subject, scopes: DELEGATION_SCOPES }),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    const grant = await this.decodeResponse('delegation', response, delegationGrantSchema)
    this.grant = { token: grant.token, refreshAt: Date.now() + grant.expiresIn * 1000 - DELEGATION_REFRESH_MARGIN_MS }
    return grant.token
  }

  /**
   * POST one JSON body to a service-relative path and validate the JSON result.
   * @param path - the request path resolved against the configured base URL.
   * @param body - the JSON-serializable request payload.
   * @param schema - the endpoint's complete response schema.
   * @param signal - optional caller cancellation; a default timeout applies when absent.
   * @returns the validated response body.
   */
  private async post<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
    // Combine the caller's cancellation with the deployment timeout so a caller
    // signal never disables the timeout and a hung server cannot wait forever.
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(new URL(path, this.apiBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.bearer(combined)}` },
      body: JSON.stringify(body),
      signal: combined,
    })
    return this.decodeResponse(path, response, schema)
  }

  /** Drop a cached exchanged token the central service rejected, so the next request exchanges again. */
  private forgetRejectedGrant(status: number): void {
    if (status === 401 || status === 403) this.grant = undefined
  }

  private async decodeResponse<T>(path: string, response: Response, schema: ZodType<T>): Promise<T> {
    if (!response.ok) {
      this.forgetRejectedGrant(response.status)
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`bid REST ${path} failed with status ${response.status}: ${detail}`)
    }
    let value: unknown
    try {
      value = await response.json()
    } catch (error: unknown) {
      throw new Error(`bid REST ${path} returned an invalid response: ${String(error)}`, { cause: error })
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new Error(`bid REST ${path} returned an invalid response: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
    }
    return parsed.data
  }
}
