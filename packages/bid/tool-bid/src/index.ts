/**
 * Model-facing bidding tools over the DeepSeek Harness event-sourced session
 * log. Each tool delegates the heavy lifting to the central bid REST service
 * through the `ctx.bid` seam and appends the authoritative result as a `bid/*`
 * snapshot to the calling agent's session; replay is last-write-wins per key,
 * and UIs render from the `bidTender`/`bidOutline`/`bidMatch` projections. A
 * non-agent caller has no owning session and is rejected. Named exports
 * preserve loader injection metadata.
 *
 * The tool names, events, projections, and cards are the durable contract; the
 * REST backend behind `ctx.bid` can change without touching what the model or
 * UI sees.
 * @module @deepseek-ai/dsh-tool-bid
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  BidMatch, BidSection, BidTender, SectionId, TenderId,
} from './types.ts'
import type {} from '@deepseek-ai/dsh-subagent'
import { createBidGenerationJob } from './generate-bid.ts'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves the required ctx.bid service declaration (the REST seam
// these tools delegate to).
import type {} from '@deepseek-ai/dsh-bid'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-jobs'
// The `bid/*` event and `bidTender`/`bidOutline`/`bidMatch` projection-key
// declarations live in @deepseek-ai/dsh-bid (their one home); this re-export
// projects the type face onto the package root AND keeps the module edge in the
// emitted index.d.ts, so aggregate programs consuming the declarations still
// receive the SessionEventMap and SessionProjectionMap merges.
export type * from './types.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    bid: 'bid'
  }
}

export const name = 'tool-bid'
export const inject = ['tools', 'sessionProjections', 'bid', 'fs', 'jobs', 'subagents']

/** File-reading configuration for streamed tender uploads. */
export interface Config {
  /** Maximum bytes requested from ctx.fs in one range read. */
  readChunkBytes: number
  /** One-shot subagent provider used to prepare section briefs. */
  subagentProvider: string
  /** Maximum section workers allowed concurrently. */
  maxConcurrentSections: number
}

export const Config: z<Config> = z.object({
  readChunkBytes: z.number().required(),
  subagentProvider: z.string().required(),
  maxConcurrentSections: z.number().required(),
})

const PARSE_DESCRIPTION =
  'Parse a tender document and load its structured summary into the session. '
  + 'Call it once per tender before matching capabilities or writing sections; '
  + 'later tender tools require a tender already loaded here. Provide the '
  + 'tender file path and its title.'

const MATCH_DESCRIPTION =
  'Match the enterprise archive against a loaded tender\'s requirements. Call it '
  + 'after bid_parse_tender; it returns how many requirements are satisfied, how '
  + 'many are gaps, and risk notes. Provide the tenderId from the loaded tender.'

const GENERATE_DESCRIPTION =
  'Generate one technical-bid section for a loaded tender. Call it once per '
  + 'section after bid_parse_tender; it returns the drafted section, which is '
  + 'folded into the bidOutline projection. Provide the tenderId and sectionId.'

const GENERATE_BID_DESCRIPTION =
  'Generate every section of the loaded tender in a managed background job. '
  + 'Bounded subagents prepare structured section briefs, the central bid service '
  + 'writes each section, and the parent session receives ordered section events.'

const EXPORT_DESCRIPTION =
  'Export a loaded tender\'s technical bid as a formatted DOCX. Call it after '
  + 'the sections are generated; it returns the produced artifact path and page '
  + 'count. Provide the tenderId.'

/**
 * Return the calling agent's session, or reject a non-agent caller that has
 * nowhere to record the durable snapshot.
 * @param exec - the tool execution carrying the optional owning agent.
 * @param toolName - the tool name used in the rejection message.
 * @returns the owning agent's session.
 */
function agentSession(exec: { agent?: { session: Session } | undefined }, toolName: string): Session {
  if (!exec.agent) {
    throw new Error(`${toolName} requires an owning agent session`)
  }
  return exec.agent.session
}

/**
 * Trim a required string field, rejecting an empty value with a stable message.
 * @param value - the raw model-supplied field.
 * @param domain - the request noun named in the rejection message.
 * @param field - the field name named in the rejection message.
 * @returns the trimmed, non-empty value.
 */
function requireField(value: string, domain: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`invalid ${domain}: \`${field}\` must be a non-empty string`)
  }
  return trimmed
}

/** Wire payload schema of the `bidTender` projection (latest tender or pre-first-load null). */
const tenderIdSchema = zod.string().transform(value => brandString<TenderId>(value))
const sectionIdSchema = zod.string().transform(value => brandString<SectionId>(value))

const legacyTenderSchema = zod.object({
  tenderId: tenderIdSchema,
  title: zod.string(),
  sectionCount: zod.number(),
})
const currentTenderSchema = legacyTenderSchema.extend({
  sections: zod.array(zod.object({ sectionId: sectionIdSchema, title: zod.string() })),
})
const bidTenderProjectionSchema: ZodType<BidTender | null> = zod.union([
  currentTenderSchema,
  legacyTenderSchema,
  zod.null(),
])

/** One section's wire shape, shared by the `bidOutline` projection schema. */
const legacyBidSectionSchema = zod.object({
  sectionId: sectionIdSchema,
  title: zod.string(),
  status: zod.union([zod.literal('draft'), zod.literal('reviewed'), zod.literal('final')]),
})
const bidSectionSchema = zod.union([
  legacyBidSectionSchema.extend({ tenderId: tenderIdSchema }),
  legacyBidSectionSchema,
])

/** Wire payload schema of the `bidOutline` projection (accumulated sections or null). */
const bidOutlineProjectionSchema: ZodType<BidSection[] | null> = zod.union([
  zod.array(bidSectionSchema),
  zod.null(),
])

/** Wire payload schema of the `bidMatch` projection (latest match or null). */
const bidMatchProjectionSchema: ZodType<BidMatch | null> = zod.union([
  zod.object({
    tenderId: tenderIdSchema,
    matched: zod.number(),
    gaps: zod.number(),
    risks: zod.array(zod.string()),
  }),
  zod.null(),
])

/**
 * Register the four bid tools on `ctx.tools` and the `bidTender`, `bidOutline`,
 * and `bidMatch` units on `ctx.sessionProjections`.
 * @param ctx - registrant context carrying the tool, session-projection, and bid registries.
 */
export function apply(ctx: Context, config: Config): void {
  if (!Number.isSafeInteger(config.readChunkBytes) || config.readChunkBytes <= 0) {
    throw new Error('tool-bid: readChunkBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.maxConcurrentSections) || config.maxConcurrentSections <= 0) {
    throw new Error('tool-bid: maxConcurrentSections must be a positive safe integer')
  }
  if (config.subagentProvider.length === 0 || config.subagentProvider !== config.subagentProvider.trim()) {
    throw new Error('tool-bid: subagentProvider must be a non-empty normalized string')
  }
  if (ctx.subagents.getProvider(config.subagentProvider) === undefined) {
    throw new Error(`tool-bid: no subagent provider registered for "${config.subagentProvider}"`)
  }
  // Latest-load fold: the most recent bid/tender-loaded summary, or null before
  // the first load; every other event returns the same state reference.
  ctx.sessionProjections.register<'bidTender', BidTender | null>({
    key: 'bidTender',
    stateSchema: bidTenderProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'bid/tender-loaded') return event.data.tender
      return state
    },
    wire: { viewSchema: bidTenderProjectionSchema, view: state => state },
    stateVersion: 1,
  })
  // Outline fold: every generated section, latest per sectionId, or null before
  // the first generation. A regenerated section replaces its prior entry.
  ctx.sessionProjections.register<'bidOutline', BidSection[] | null>({
    key: 'bidOutline',
    stateSchema: bidOutlineProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'bid/tender-loaded') return null
      if (event.type !== 'bid/section-generated') return state
      const section = event.data.section
      const current = state ?? []
      const index = current.findIndex(each => each.sectionId === section.sectionId)
      if (index === -1) return [...current, section]
      return [...current.slice(0, index), section, ...current.slice(index + 1)]
    },
    wire: { viewSchema: bidOutlineProjectionSchema, view: state => state },
    stateVersion: 1,
  })
  // Latest-match fold: the most recent bid/capability-matched result, or null
  // before the first match.
  ctx.sessionProjections.register<'bidMatch', BidMatch | null>({
    key: 'bidMatch',
    stateSchema: bidMatchProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'bid/tender-loaded') return null
      if (event.type === 'bid/capability-matched') return event.data.match
      return state
    },
    wire: { viewSchema: bidMatchProjectionSchema, view: state => state },
    stateVersion: 1,
  })

  ctx.tools.register(defineTool({
    name: 'bid_parse_tender',
    description: PARSE_DESCRIPTION,
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative path to the tender document to parse.' },
      title: { type: 'string', required: true, description: 'Human-readable tender title shown in the conversation card.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tender: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              tenderId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              sectionCount: { type: 'integer', required: true },
              sections: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    sectionId: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Loaded tender "${value.tender.title}" (${value.tender.tenderId}), ${value.tender.sectionCount} sections.`,
      }],
      presentationMeta: (_args, value) => ({
        version: 1,
        kind: 'tender',
        id: `bid:tender:${value.tender.tenderId}`,
      }),
    },
    async execute(args, exec) {
      const session = agentSession(exec, 'bid_parse_tender')
      const title = requireField(args.title, 'tender', 'title')
      const path = requireField(args.path, 'tender', 'path')
      const target = await ctx.fs.resolve(path, {
        ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
        signal: exec.signal,
      })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) throw new Error(`tender file not found: ${target.displayPath}`)
      if (info.type !== 'file') throw new Error(`tender path is not a regular file: ${target.displayPath}`)
      if (info.size === undefined) throw new Error(`tender file size is unavailable: ${target.displayPath}`)
      const size = info.size
      const data = (async function* (): AsyncIterable<Uint8Array> {
        let offset = 0
        while (offset < size) {
          const chunk = await ctx.fs.readByteRange(target, {
            offset,
            length: Math.min(config.readChunkBytes, size - offset),
          }, exec.signal)
          if (chunk.byteLength === 0) throw new Error(`tender file ended before ${size} bytes`)
          offset += chunk.byteLength
          yield chunk
        }
      })()
      const name = target.displayPath.replaceAll('\\', '/').split('/').pop() ?? 'tender'
      const tender = await ctx.bid.parseTender({
        title,
        name,
        bytes: size,
        data,
        sessionId: session.id,
      }, exec.signal)
      session.append('bid/tender-loaded', { tender })
      return { tender }
    },
    presentCall: args => ({ card: 'generic', title: 'Parse tender', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'bid_match_capabilities',
    description: MATCH_DESCRIPTION,
    parameters: {
      tenderId: { type: 'string', required: true, description: 'Identifier of the loaded tender to match against.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          match: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              tenderId: { type: 'string', required: true },
              matched: { type: 'integer', required: true },
              gaps: { type: 'integer', required: true },
              risks: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Matched ${value.match.matched} requirements, ${value.match.gaps} gaps for tender ${value.match.tenderId}.`,
      }],
      presentationMeta: (_args, value) => ({
        version: 1,
        kind: 'match',
        id: `bid:match:${value.match.tenderId}`,
      }),
    },
    async execute(args, exec) {
      const session = agentSession(exec, 'bid_match_capabilities')
      const tenderId = requireField(args.tenderId, 'match request', 'tenderId')
      const match = await ctx.bid.matchCapabilities({ tenderId: brandString<TenderId>(tenderId) }, exec.signal)
      session.append('bid/capability-matched', { match })
      return { match }
    },
    presentCall: args => ({ card: 'generic', title: 'Match capabilities', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'bid_generate_section',
    description: GENERATE_DESCRIPTION,
    parameters: {
      tenderId: { type: 'string', required: true, description: 'Identifier of the loaded tender owning the section.' },
      sectionId: { type: 'string', required: true, description: 'Identifier of the outline section to generate.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              tenderId: { type: 'string', required: true },
              sectionId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              status: { type: 'string', required: true, enum: ['draft', 'reviewed', 'final'] },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Generated section "${value.section.title}" (${value.section.sectionId}), status ${value.section.status}.`,
      }],
      presentationMeta: (_args, value) => ({
        version: 1,
        kind: 'section',
        id: `bid:section:${value.section.tenderId}:${value.section.sectionId}`,
      }),
    },
    async execute(args, exec) {
      const session = agentSession(exec, 'bid_generate_section')
      const tenderId = requireField(args.tenderId, 'section request', 'tenderId')
      const sectionId = requireField(args.sectionId, 'section request', 'sectionId')
      const section = await ctx.bid.generateSection({
        tenderId: brandString<TenderId>(tenderId),
        sectionId: brandString<SectionId>(sectionId),
      }, exec.signal)
      session.append('bid/section-generated', { section })
      return { section }
    },
    presentCall: args => ({ card: 'generic', title: 'Generate section', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'bid_generate_bid',
    description: GENERATE_BID_DESCRIPTION,
    parameters: {
      tenderId: { type: 'string', required: true, description: 'Identifier of the loaded tender to generate.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { jobId: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Started whole-bid generation job ${value.jobId}.` }],
    },
    execute(args, exec) {
      const session = agentSession(exec, 'bid_generate_bid')
      const owner = exec.agent as Agent
      const requested = requireField(args.tenderId, 'whole-bid request', 'tenderId')
      const tender = ctx.sessionProjections.stateOf(session, 'bidTender')
      if (tender === undefined) throw new Error('bid_generate_bid requires the bidTender projection')
      if (tender === null || tender.tenderId !== requested) {
        throw new Error(`bid_generate_bid needs loaded tender ${requested}`)
      }
      if (tender.sections === undefined) throw new Error('bid_generate_bid requires a tender section manifest')
      if (tender.sections.length === 0) throw new Error('bid_generate_bid requires at least one tender section')
      const jobId = ctx.jobs.start({
        kind: 'bid',
        label: `Generate bid: ${tender.title}`,
        owner,
        run: () => createBidGenerationJob({
          owner,
          session,
          tender: { ...tender, sections: tender.sections ?? [] },
          bid: ctx.bid,
          subagents: ctx.subagents,
          provider: config.subagentProvider,
          maxConcurrentSections: config.maxConcurrentSections,
        }),
      })
      return Promise.resolve({ jobId })
    },
    presentCall: args => ({ card: 'generic', title: 'Generate whole bid', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'bid_export',
    description: EXPORT_DESCRIPTION,
    parameters: {
      tenderId: { type: 'string', required: true, description: 'Identifier of the loaded tender to export.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifact: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              tenderId: { type: 'string', required: true },
              exportId: { type: 'string', required: true },
              docxPath: { type: 'string', required: true },
              pages: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exported bid to ${value.artifact.docxPath} (${value.artifact.pages} pages).`,
      }],
      presentationMeta: (_args, value) => ({
        version: 1,
        kind: 'export',
        id: `bid:export:${value.artifact.exportId}`,
      }),
    },
    async execute(args, exec) {
      const session = agentSession(exec, 'bid_export')
      const tenderId = requireField(args.tenderId, 'export request', 'tenderId')
      const artifact = await ctx.bid.exportBid({
        tenderId: brandString<TenderId>(tenderId),
        session,
        destination: `bid-${tenderId.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.docx`,
      }, exec.signal)
      session.append('bid/export-produced', { artifact })
      return { artifact }
    },
    presentCall: args => ({ card: 'generic', title: 'Export bid', kind: 'other', rawInput: args }),
  }))
}
