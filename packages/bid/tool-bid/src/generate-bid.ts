/** Whole-bid background orchestration helpers. @module @deepseek-ai/dsh-tool-bid/generate-bid */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BidClient, BidSectionBrief, BidTender } from '@deepseek-ai/dsh-bid'
import type { JobHooks, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

const briefSchema: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sectionId', 'strategy', 'requirements'],
  properties: {
    sectionId: { type: 'string' },
    strategy: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
  },
}

function parseBrief(value: unknown, sectionId: string): BidSectionBrief {
  if (typeof value !== 'object' || value === null) throw new Error(`section ${sectionId} returned no structured brief`)
  const candidate = value as { sectionId?: unknown; strategy?: unknown; requirements?: unknown }
  if (candidate.sectionId !== sectionId) throw new Error(`section ${sectionId} returned a different sectionId`)
  if (typeof candidate.strategy !== 'string' || candidate.strategy.trim().length === 0) {
    throw new Error(`section ${sectionId} returned an empty strategy`)
  }
  if (!Array.isArray(candidate.requirements) || !candidate.requirements.every(item => typeof item === 'string')) {
    throw new Error(`section ${sectionId} returned invalid requirements`)
  }
  const requirements = candidate.requirements.filter((item): item is string => typeof item === 'string')
  return {
    sectionId: sectionId as BidSectionBrief['sectionId'],
    strategy: candidate.strategy,
    requirements,
  }
}

async function settleRun(run: SubagentRun, sectionId: string): Promise<BidSectionBrief> {
  try {
    const result = await run.result
    if (result.stopReason !== 'completed') {
      throw new Error(`section ${sectionId} subagent stopped: ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}`)
    }
    return parseBrief(result.structured, sectionId)
  } finally {
    await run.dispose()
  }
}

/**
 * Create one cancellable job that prepares section briefs concurrently and commits generated sections in manifest order.
 * @param options - owner, tender, services, provider, and worker limit.
 * @returns synchronous hooks suitable for `ctx.jobs.start()`.
 */
export function createBidGenerationJob(options: {
  owner: Agent
  session: Session
  tender: Required<Pick<BidTender, 'sections'>> & BidTender
  bid: BidClient
  subagents: SubagentRuntime
  provider: string
  maxConcurrentSections: number
}): JobHooks {
  const controller = new AbortController()
  const runs = new Set<SubagentRun>()
  let failure: unknown
  const lifecycle = { externallyCancelled: false }
  const done: Promise<JobOutcome> = (async () => {
    try {
      const briefs = new Array<BidSectionBrief>(options.tender.sections.length)
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (!controller.signal.aborted && failure === undefined) {
          const index = cursor++
          const ref = options.tender.sections[index]
          if (ref === undefined) return
          let run: SubagentRun | undefined
          try {
            run = await options.subagents.start(options.provider, {
              label: `Bid section: ${ref.title}`,
              parent: options.owner,
              signal: controller.signal,
              outputSchema: briefSchema,
              prompt: [{
                type: 'text',
                text: `Prepare a concise generation brief for tender section ${ref.sectionId} (${ref.title}). Return only the requested structured result.`,
              }],
            })
            runs.add(run)
            if (lifecycle.externallyCancelled) {
              await run.dispose()
              return
            }
            briefs[index] = await settleRun(run, ref.sectionId)
          } catch (error: unknown) {
            if (!lifecycle.externallyCancelled) {
              failure = error
              controller.abort('section brief failed')
            }
          } finally {
            if (run !== undefined) runs.delete(run)
          }
        }
      }
      const workers = Array.from(
        { length: Math.min(options.maxConcurrentSections, options.tender.sections.length) },
        worker,
      )
      await Promise.allSettled(workers)
      if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error('section brief worker failed')
      }
      if (controller.signal.aborted) return { status: 'killed', detail: 'cancelled before section commit' }
      const generated = []
      for (const brief of briefs) {
        generated.push(await options.bid.generateSection({
          tenderId: options.tender.tenderId,
          sectionId: brief.sectionId,
          brief,
        }, controller.signal))
        if (lifecycle.externallyCancelled) return { status: 'killed', detail: 'cancelled before section commit' }
      }
      if (lifecycle.externallyCancelled) return { status: 'killed', detail: 'cancelled before section commit' }
      for (const section of generated) options.session.append('bid/section-generated', { section })
      return {
        status: 'completed',
        detail: `${briefs.length} sections generated`,
        output: `Generated ${briefs.length} sections for tender ${options.tender.tenderId}.`,
      }
    } catch (error: unknown) {
      return {
        status: failure === undefined && controller.signal.aborted ? 'killed' : 'failed',
        detail: error instanceof Error ? error.message : String(error),
      }
    } finally {
      await Promise.allSettled([...runs].map(run => run.dispose()))
    }
  })()
  return {
    cancel: (reason) => {
      if (controller.signal.aborted) return
      lifecycle.externallyCancelled = true
      controller.abort(reason)
      for (const run of runs) void run.dispose()
    },
    done,
  }
}
