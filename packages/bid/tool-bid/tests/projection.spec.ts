/**
 * The `bidTender` projection provider: mounting tool-bid beside the registry
 * serves the latest loaded tender with a consistent asOfSeq (= last event seq);
 * before any load the value is null; a composition without tool-bid has no
 * `bidTender` key; unmounting tool-bid removes it (HMR safety). The carrier and
 * framework are exercised unmodified.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { BidTender, SectionId, TenderId } from '@deepseek-ai/dsh-tool-bid'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import BidService from '@deepseek-ai/dsh-bid'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolBid from '@deepseek-ai/dsh-tool-bid'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'

interface Bench {
  ctx: Context
  session: Session
  tailProjections(): Promise<{ asOfSeq: number; values: Record<string, unknown> } | undefined>
}

async function harness(withBidTool: boolean): Promise<Bench> {
  process.env.BID_TEST_TOKEN = 'projection-token'
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalFileSystem, {})
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'test',
    capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('unused test provider')),
  })
  // tool-bid injects the bid REST seam; projection folds are driven by directly
  // appended events here, so the service only needs to exist (never called).
  await ctx.plugin(BidService, {
    apiBaseUrl: 'http://127.0.0.1:1/api', tokenEnv: 'BID_TEST_TOKEN', maxTenderBytes: 1048576, maxExportBytes: 1048576,
  })
  if (withBidTool) {
    await ctx.plugin(ToolBid, { readChunkBytes: 65536, subagentProvider: 'test', maxConcurrentSections: 2 })
  }
  const session = ctx.sessions.create()
  await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    async tailProjections() {
      return ctx.sessionProjections.snapshot(session)
    },
  }
}

/** One paginable message so the tail page is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('bidTender projection provider', () => {
  it('serves null before the first bid/tender-loaded', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections?.values.bidTender).toBeNull()
    expect(projections?.asOfSeq).toBe(bench.session.seq - 1)
  })

  it('serves the latest tender after loads, asOfSeq = last event seq', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    const first: BidTender = { tenderId: brandString<TenderId>('tender:a'), title: 'fixture', sections: [], sectionCount: 0 }
    const second: BidTender = { tenderId: brandString<TenderId>('tender:b'), title: 'fixture', sections: [], sectionCount: 0 }
    session.append('turn/start', { turn: 1 })
    session.append('bid/tender-loaded', { tender: first })
    session.append('bid/tender-loaded', { tender: second })
    const projections = await bench.tailProjections()
    // Last-wins: the latest snapshot, whole.
    expect(projections?.values.bidTender).toEqual(second)
    expect(projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('keeps the loaded tender across an unrelated event (the fold default branch)', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    const tender: BidTender = { tenderId: brandString<TenderId>('tender:keep'), title: 'fixture', sections: [], sectionCount: 0 }
    session.append('bid/tender-loaded', { tender })
    session.append('turn/start', { turn: 1 })
    expect((await bench.tailProjections())?.values.bidTender).toEqual(tender)
  })

  it('has no bidTender key when tool-bid is not composed', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections).toBeDefined()
    expect('bidTender' in (projections?.values ?? {})).toBe(false)
  })

  it('drops the key when the tool-bid fiber unloads (HMR safety)', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const fiber = await bench.ctx.plugin(ToolBid, {
      readChunkBytes: 65536, subagentProvider: 'test', maxConcurrentSections: 2,
    })
    expect((await bench.tailProjections())?.values.bidTender).toBeNull()
    await fiber.dispose()
    expect('bidTender' in ((await bench.tailProjections())?.values ?? {})).toBe(false)
  })

  it('folds generated sections into bidOutline, latest per sectionId', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    expect((await bench.tailProjections())?.values.bidOutline).toBeNull()
    session.append('bid/section-generated', { section: { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1'), title: 'fixture', status: 'draft' } })
    session.append('bid/section-generated', { section: { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s2'), title: 'fixture', status: 'draft' } })
    expect((await bench.tailProjections())?.values.bidOutline).toEqual([
      { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1'), title: 'fixture', status: 'draft' },
      { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s2'), title: 'fixture', status: 'draft' },
    ])
    // Regenerating s1 replaces it in place, preserving outline order.
    session.append('bid/section-generated', { section: { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1'), title: 'fixture', status: 'reviewed' } })
    expect((await bench.tailProjections())?.values.bidOutline).toEqual([
      { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1'), title: 'fixture', status: 'reviewed' },
      { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s2'), title: 'fixture', status: 'draft' },
    ])
  })

  it('clears tender-scoped outline and match when another tender loads', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    session.append('bid/tender-loaded', { tender: { tenderId: brandString<TenderId>('a'), title: 'A', sections: [], sectionCount: 0 } })
    session.append('bid/section-generated', { section: { tenderId: brandString<TenderId>('a'), sectionId: brandString<SectionId>('s1'), title: 'S1', status: 'draft' } })
    session.append('bid/capability-matched', { match: { tenderId: brandString<TenderId>('a'), matched: 1, gaps: 0, risks: [] } })
    session.append('bid/tender-loaded', { tender: { tenderId: brandString<TenderId>('b'), title: 'B', sections: [], sectionCount: 0 } })
    const values = (await bench.tailProjections())?.values
    expect(values?.bidTender).toMatchObject({ tenderId: brandString<TenderId>('b') })
    expect(values?.bidOutline).toBeNull()
    expect(values?.bidMatch).toBeNull()
  })

  it('serves the latest bidMatch and keeps it across an unrelated event', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    expect((await bench.tailProjections())?.values.bidMatch).toBeNull()
    session.append('bid/capability-matched', { match: { tenderId: brandString<TenderId>('t1'), matched: 8, gaps: 2, risks: [] } })
    session.append('bid/capability-matched', { match: { tenderId: brandString<TenderId>('t1'), matched: 9, gaps: 1, risks: ['x'] } })
    session.append('turn/start', { turn: 1 })
    expect((await bench.tailProjections())?.values.bidMatch).toEqual({ tenderId: brandString<TenderId>('t1'), matched: 9, gaps: 1, risks: ['x'] })
  })
})
