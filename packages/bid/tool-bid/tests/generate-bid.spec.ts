import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BidClient, BidSectionBrief, SectionId, TenderId } from '@deepseek-ai/dsh-bid'
import type { SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { createBidGenerationJob } from '../src/generate-bid.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function fixture() {
  const session = Session.create(SessionId('bid-parent'))
  const owner = { id: session.id, session } as unknown as Agent
  const sections = ['s1', 's2', 's3'].map((id, index) => ({
    sectionId: brandString<SectionId>(id), title: `Section ${index + 1}`,
  }))
  const tender = {
    tenderId: brandString<TenderId>('t1'), title: 'Tender', sectionCount: sections.length, sections,
  }
  return { session, owner, tender }
}

function brief(sectionId: string): BidSectionBrief {
  return {
    sectionId: brandString<SectionId>(sectionId),
    strategy: `strategy:${sectionId}`,
    requirements: [`requirement:${sectionId}`],
  }
}

describe('whole-bid background orchestration', () => {
  it('bounds child concurrency and commits generated sections in manifest order', async () => {
    const { session, owner, tender } = fixture()
    const releases = tender.sections.map(() => deferred<undefined>())
    let active = 0
    let peak = 0
    const started: string[] = []
    const disposed: string[] = []
    const subagents = {
      async start(_provider: string, request: { prompt: { type: string; text: string }[] }): Promise<SubagentRun> {
        const sectionId = request.prompt[0]!.text.match(/section (s\d+)/)?.[1] ?? 'missing'
        const index = Number(sectionId.slice(1)) - 1
        started.push(sectionId)
        active += 1
        peak = Math.max(peak, active)
        return {
          id: SessionId(`child-${sectionId}`),
          localAgent: undefined,
          result: releases[index]!.promise.then(() => ({
            output: [], structured: brief(sectionId), stopReason: 'completed' as const,
          })),
          async dispose() { active -= 1; disposed.push(sectionId) },
        }
      },
    } as unknown as SubagentRuntime
    const generated: string[] = []
    const bid = {
      async generateSection(request: { sectionId: SectionId }) {
        generated.push(request.sectionId)
        return { tenderId: tender.tenderId, sectionId: request.sectionId, title: request.sectionId, status: 'draft' as const }
      },
    } as unknown as BidClient
    const hooks = createBidGenerationJob({
      owner, session, tender, bid, subagents, provider: 'test', maxConcurrentSections: 2,
    })
    await Promise.resolve()
    expect(started).toEqual(['s1', 's2'])
    releases[1]!.resolve(undefined)
    for (let turn = 0; turn < 10 && started.length < 3; turn += 1) await Promise.resolve()
    expect(started).toEqual(['s1', 's2', 's3'])
    releases[2]!.resolve(undefined)
    releases[0]!.resolve(undefined)
    const outcome = await hooks.done
    expect(outcome).toMatchObject({ status: 'completed', detail: '3 sections generated' })
    expect(peak).toBe(2)
    expect(disposed.sort()).toEqual(['s1', 's2', 's3'])
    expect(generated).toEqual(['s1', 's2', 's3'])
    expect(session.snapshotEvents().filter(event => event.type === 'bid/section-generated')
      .map(event => event.data.section.sectionId)).toEqual(tender.sections.map(section => section.sectionId))
  })

  it('joins a sibling when one child fails and starts no later section', async () => {
    const { session, owner, tender } = fixture()
    const sibling = deferred<undefined>()
    const started: string[] = []
    const disposed: string[] = []
    const subagents = {
      async start(_provider: string, request: { prompt: { type: string; text: string }[] }): Promise<SubagentRun> {
        const sectionId = request.prompt[0]!.text.match(/section (s\d+)/)?.[1] ?? 'missing'
        started.push(sectionId)
        let didDispose = false
        return {
          id: SessionId(`child-${sectionId}`), localAgent: undefined,
          result: sectionId === 's1'
            ? Promise.resolve({ output: [], stopReason: 'error' as const, diagnostic: 'failed' })
            : sibling.promise.then(() => ({ output: [], structured: brief(sectionId), stopReason: 'completed' as const })),
          async dispose() {
            if (didDispose) return
            didDispose = true
            disposed.push(sectionId)
            sibling.resolve(undefined)
          },
        }
      },
    } as unknown as SubagentRuntime
    const hooks = createBidGenerationJob({
      owner, session, tender, bid: {} as BidClient, subagents, provider: 'test', maxConcurrentSections: 2,
    })
    await expect(hooks.done).resolves.toMatchObject({ status: 'failed' })
    expect(started).toEqual(['s1', 's2'])
    expect(disposed.sort()).toEqual(['s1', 's2'])
    expect(session.snapshotEvents().some(event => event.type === 'bid/section-generated')).toBe(false)
  })

  it('cancels a run published after cancellation during start', async () => {
    const { session, owner, tender } = fixture()
    const startGate = deferred<undefined>()
    let disposed = false
    const subagents = {
      async start(): Promise<SubagentRun> {
        await startGate.promise
        return {
          id: SessionId('late-child'), localAgent: undefined,
          result: new Promise(() => undefined),
          async dispose() { disposed = true },
        }
      },
    } as unknown as SubagentRuntime
    const hooks = createBidGenerationJob({
      owner, session, tender, bid: {} as BidClient, subagents, provider: 'test', maxConcurrentSections: 1,
    })
    hooks.cancel('during start')
    startGate.resolve(undefined)
    await expect(hooks.done).resolves.toMatchObject({ status: 'killed' })
    expect(disposed).toBe(true)
  })

  it('does not append partial events when a later central generation fails', async () => {
    const { session, owner, tender } = fixture()
    const subagents = {
      async start(_provider: string, request: { prompt: { type: string; text: string }[] }): Promise<SubagentRun> {
        const sectionId = request.prompt[0]!.text.match(/section (s\d+)/)?.[1] ?? 'missing'
        return {
          id: SessionId(`child-${sectionId}`), localAgent: undefined,
          result: Promise.resolve({ output: [], structured: brief(sectionId), stopReason: 'completed' as const }),
          dispose: () => Promise.resolve(),
        }
      },
    } as unknown as SubagentRuntime
    let calls = 0
    const bid = {
      async generateSection(request: { sectionId: SectionId }) {
        calls += 1
        if (calls === 2) throw new Error('central failed')
        return { tenderId: tender.tenderId, sectionId: request.sectionId, title: request.sectionId, status: 'draft' as const }
      },
    } as unknown as BidClient
    const hooks = createBidGenerationJob({
      owner, session, tender, bid, subagents, provider: 'test', maxConcurrentSections: 2,
    })
    await expect(hooks.done).resolves.toMatchObject({ status: 'failed', detail: 'central failed' })
    expect(session.snapshotEvents().some(event => event.type === 'bid/section-generated')).toBe(false)
  })

  it('publishes no parent events when cancelled during central generation', async () => {
    const { session, owner, tender } = fixture()
    const generation = deferred<undefined>()
    const subagents = {
      async start(_provider: string, request: { prompt: { type: string; text: string }[] }): Promise<SubagentRun> {
        const sectionId = request.prompt[0]!.text.match(/section (s\d+)/)?.[1] ?? 'missing'
        return {
          id: SessionId(`child-${sectionId}`), localAgent: undefined,
          result: Promise.resolve({ output: [], structured: brief(sectionId), stopReason: 'completed' as const }),
          dispose: () => Promise.resolve(),
        }
      },
    } as unknown as SubagentRuntime
    let entered = false
    const bid = {
      async generateSection(request: { sectionId: SectionId }) {
        entered = true
        await generation.promise
        return { tenderId: tender.tenderId, sectionId: request.sectionId, title: request.sectionId, status: 'draft' as const }
      },
    } as unknown as BidClient
    const hooks = createBidGenerationJob({
      owner, session, tender, bid, subagents, provider: 'test', maxConcurrentSections: 2,
    })
    for (let turn = 0; turn < 20 && !entered; turn += 1) await Promise.resolve()
    expect(entered).toBe(true)
    hooks.cancel('during central generation')
    generation.resolve(undefined)
    await expect(hooks.done).resolves.toMatchObject({ status: 'killed' })
    expect(session.snapshotEvents().some(event => event.type === 'bid/section-generated')).toBe(false)
  })

  it('cancels and disposes every active child before the job settles', async () => {
    const { session, owner, tender } = fixture()
    const disposed: string[] = []
    const subagents = {
      async start(_provider: string, request: { signal: AbortSignal; prompt: { type: string; text: string }[] }): Promise<SubagentRun> {
        const sectionId = request.prompt[0]!.text.match(/section (s\d+)/)?.[1] ?? 'missing'
        const result = new Promise<never>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
        let didDispose = false
        return {
          id: SessionId(`child-${sectionId}`), localAgent: undefined, result,
          async dispose() {
            if (didDispose) return
            didDispose = true
            disposed.push(sectionId)
          },
        }
      },
    } as unknown as SubagentRuntime
    const hooks = createBidGenerationJob({
      owner, session, tender, bid: {} as BidClient, subagents, provider: 'test', maxConcurrentSections: 2,
    })
    await Promise.resolve()
    hooks.cancel('test cancellation')
    await expect(hooks.done).resolves.toMatchObject({ status: 'killed' })
    expect(disposed.sort()).toEqual(['s1', 's2'])
    expect(session.snapshotEvents().some(event => event.type === 'bid/section-generated')).toBe(false)
  })
})
