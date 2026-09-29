import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import BidService from '@deepseek-ai/dsh-bid'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {
  BidExport, BidExportId, BidMatch, BidSection, BidTender, SectionId, TenderId,
} from '@deepseek-ai/dsh-tool-bid'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'

import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/**
 * Drives the REAL plugin body: mounts `dsh-tool-bid` over a real `ctx.bid`
 * (BidService pointed at a local `node:http` mock of the central bid REST
 * service) and invokes each tool through `ctx.tools.execute`, with a fake parent
 * Agent carrying a real `Session`. The mock echoes each request as its result,
 * so a passing assertion proves the value flowed tool -> ctx.bid -> HTTP -> log
 * rather than being derived in the tool.
 */

let server: Server
let base: string
let parseCalls: number

/** Route the mock by request path, echoing the request into each canned shape. */
function mockResponse(url: string, body: Record<string, string>): unknown {
  if (url.startsWith('/tenders/parse?')) {
    const query = new URL(url, 'http://localhost').searchParams
    return { tenderId: brandString<TenderId>('tender:uploaded'), title: query.get('title'), sections: [], sectionCount: 0 }
  }
  if (url === '/match') return { tenderId: body.tenderId, matched: 8, gaps: 2, risks: ['fixture'] }
  if (url === '/sections/generate') return { tenderId: body.tenderId, sectionId: body.sectionId, title: `fixture${body.sectionId}`, status: 'draft' }
  return { tenderId: body.tenderId, exportId: `export:${body.tenderId}`, downloadPath: `exports/${body.tenderId}.docx`, pages: 42 }
}

beforeEach(async () => {
  parseCalls = 0
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if ((req.url ?? '').startsWith('/exports/')) {
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': '3' })
      res.end(Buffer.from([1, 2, 3]))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const body = (req.url ?? '').startsWith('/tenders/parse?') ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>
      if ((req.url ?? '').startsWith('/tenders/parse?')) parseCalls += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(mockResponse(req.url ?? '', body)))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  delete process.env.BID_TEST_TOKEN
})

let workspace = process.cwd()

/** A parent Agent backed by a real Session fixture the tool reads through `agent.session`. */
function agentWithSession(id = 'parent-1', ctx?: Context): Agent & { session: Session } {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, undefined, {
    version: 3,
    id: sessionId,
    createdAt: Date.now(),
    cwd: workspace,
    isSeeded: false,
  })
  return { id: SessionId(id), session, ctx } as unknown as Agent & { session: Session }
}

async function setup(): Promise<Context> {
  process.env.BID_TEST_TOKEN = 'tool-token'
  workspace = await mkdtemp(join(tmpdir(), 'dsh-tool-bid-'))
  await mkdir(join(workspace, 'tenders'), { recursive: true })
  await writeFile(join(workspace, 'tenders/a.docx'), Uint8Array.of(1, 2))
  await writeFile(join(workspace, 'tenders/b.docx'), Uint8Array.of(3, 4))
  const ctx = new Context()
  ctx.effect(() => () => rm(workspace, { recursive: true, force: true }))
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolJobs)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'test',
    capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('unused test provider')),
  })
  await ctx.plugin(BidService, { apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', maxTenderBytes: 1048576, maxExportBytes: 1048576 })
  await ctx.plugin(tool, { readChunkBytes: 65536, subagentProvider: 'test', maxConcurrentSections: 2 })
  return ctx
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown, over: { agent?: Agent | undefined } = {}) {
  const agent = 'agent' in over ? over.agent : agentWithSession()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('bid tool presentation metadata', () => {
  it('persists stable card correlation ids for the four domain-result tools', async () => {
    const ctx = await setup()
    const cases = [
      ['bid_parse_tender', { tender: { tenderId: 't1', title: 'Tender', sections: [], sectionCount: 0 } }, { version: 1, kind: 'tender', id: 'bid:tender:t1' }],
      ['bid_match_capabilities', { match: { tenderId: 't1', matched: 1, gaps: 0, risks: [] } }, { version: 1, kind: 'match', id: 'bid:match:t1' }],
      ['bid_generate_section', { section: { tenderId: 't1', sectionId: 's1', title: 'Section', status: 'draft' } }, { version: 1, kind: 'section', id: 'bid:section:t1:s1' }],
      ['bid_export', { artifact: { tenderId: 't1', exportId: 'e1', docxPath: 'bid.docx', pages: 1 } }, { version: 1, kind: 'export', id: 'bid:export:e1' }],
    ] as const
    for (const [name, value, expected] of cases) {
      expect(ctx.tools.get(name)?.output.presentationMeta?.({}, structuredClone(value) as never)).toEqual(expected)
    }
  })
})

describe('bid_parse_tender', () => {
  it('registers a schema of {path,title}', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'bid_parse_tender')
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['path', 'title'])
  })

  it('delegates to ctx.bid and appends the returned summary', async () => {
    const ctx = await setup()
    const agent = agentWithSession('writer')
    const result = await callTool(ctx, 'bid_parse_tender', { path: 'tenders/a.docx', title: 'fixture' }, { agent })
    expect(result.isError, text(result)).toBe(false)
    if (result.isError) throw new Error('expected success')
    const tender: BidTender = { tenderId: brandString<TenderId>('tender:uploaded'), title: 'fixture', sections: [], sectionCount: 0 }
    expect(result.value).toEqual({ tender })
    expect(text(result)).toContain('Loaded tender "fixture')
    expect(parseCalls).toBe(1)
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'bid/tender-loaded')!.data.tender).toEqual(tender)
  })

  it('sends the trimmed title and path to the service', async () => {
    const ctx = await setup()
    const agent = agentWithSession('trim')
    await callTool(ctx, 'bid_parse_tender', { path: '  tenders/b.docx  ', title: '   padded fixture ' }, { agent })
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'bid/tender-loaded')!.data.tender)
      .toEqual({ tenderId: brandString<TenderId>('tender:uploaded'), title: 'padded fixture', sections: [], sectionCount: 0 })
  })

  it('presents with a stable title and the args as raw input', async () => {
    const ctx = await setup()
    const args = { path: 'tenders/e.docx', title: 'fixture' }
    expect(ctx.tools.get('bid_parse_tender')!.presentCall?.(args))
      .toEqual({ card: 'generic', title: 'Parse tender', kind: 'other', rawInput: args })
  })
})

describe('bid_match_capabilities', () => {
  it('delegates to ctx.bid and appends bid/capability-matched', async () => {
    const ctx = await setup()
    const agent = agentWithSession('matcher')
    const result = await callTool(ctx, 'bid_match_capabilities', { tenderId: brandString<TenderId>('t1') }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const match: BidMatch = { tenderId: brandString<TenderId>('t1'), matched: 8, gaps: 2, risks: ['fixture'] }
    expect(result.value).toEqual({ match })
    expect(text(result)).toContain('Matched 8 requirements, 2 gaps for tender t1.')
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'bid/capability-matched')!.data.match).toEqual(match)
  })

  it('rejects an empty tenderId before calling the service', async () => {
    const ctx = await setup()
    const agent = agentWithSession('match-reject')
    const result = await callTool(ctx, 'bid_match_capabilities', { tenderId: brandString<TenderId>('  ') }, { agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid match request: `tenderId` must be a non-empty string')
    expect(agent.session.snapshotEvents().some(e => e.type === 'bid/capability-matched')).toBe(false)
  })

  it('presents with a stable title', async () => {
    const ctx = await setup()
    const args = { tenderId: brandString<TenderId>('t1') }
    expect(ctx.tools.get('bid_match_capabilities')!.presentCall?.(args))
      .toEqual({ card: 'generic', title: 'Match capabilities', kind: 'other', rawInput: args })
  })
})

describe('bid_generate_section', () => {
  it('delegates to ctx.bid and appends bid/section-generated', async () => {
    const ctx = await setup()
    const agent = agentWithSession('generator')
    const result = await callTool(ctx, 'bid_generate_section', { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1') }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const section: BidSection = { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1'), title: 'fixtures1', status: 'draft' }
    expect(result.value).toEqual({ section })
    expect(text(result)).toContain('Generated section "fixtures1" (s1), status draft.')
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'bid/section-generated')!.data.section).toEqual(section)
  })

  it('rejects an empty sectionId before calling the service', async () => {
    const ctx = await setup()
    const agent = agentWithSession('gen-reject')
    const result = await callTool(ctx, 'bid_generate_section', { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>(' ') }, { agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid section request: `sectionId` must be a non-empty string')
    expect(agent.session.snapshotEvents().some(e => e.type === 'bid/section-generated')).toBe(false)
  })

  it('presents with a stable title', async () => {
    const ctx = await setup()
    const args = { tenderId: brandString<TenderId>('t1'), sectionId: brandString<SectionId>('s1') }
    expect(ctx.tools.get('bid_generate_section')!.presentCall?.(args))
      .toEqual({ card: 'generic', title: 'Generate section', kind: 'other', rawInput: args })
  })
})

describe('bid_generate_bid', () => {
  it('starts an owner-scoped job through ToolRuntime', async () => {
    const ctx = await setup()
    const agent = agentWithSession('whole-bid-owner', ctx)
    await ctx.agents.register(agent)
    const tender: BidTender = {
      tenderId: brandString<TenderId>('t1'),
      title: 'Tender',
      sectionCount: 1,
      sections: [{ sectionId: brandString<SectionId>('s1'), title: 'Section' }],
    }
    agent.session.append('bid/tender-loaded', { tender })
    const result = await callTool(ctx, 'bid_generate_bid', { tenderId: 't1' }, { agent })
    expect(result.isError, text(result)).toBe(false)
    if (result.isError) throw new Error('expected success')
    const { jobId } = result.value as { jobId: string }
    expect(jobId).toMatch(/^bid-/)
    expect(ctx.jobs.get(jobId as never, agent).ownerSession).toBe(agent.session.id)
    await expect(ctx.jobs.wait(jobId as never, 1_000, agent)).resolves.toMatchObject({ status: 'failed' })
  })

  it('rejects a tender without a current section manifest', async () => {
    const ctx = await setup()
    const agent = agentWithSession('legacy-whole-bid', ctx)
    await ctx.agents.register(agent)
    agent.session.append('bid/tender-loaded', {
      tender: { tenderId: brandString<TenderId>('legacy'), title: 'Legacy', sectionCount: 1 },
    })
    const result = await callTool(ctx, 'bid_generate_bid', { tenderId: 'legacy' }, { agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a tender section manifest')
    expect(ctx.jobs.list(agent)).toEqual([])
  })
})

describe('bid_export', () => {
  it('delegates to ctx.bid and appends bid/export-produced', async () => {
    const ctx = await setup()
    const agent = agentWithSession('exporter')
    const result = await callTool(ctx, 'bid_export', { tenderId: brandString<TenderId>('t1') }, { agent })
    if (result.isError) throw new Error(text(result))
    const artifact: BidExport = { tenderId: brandString<TenderId>('t1'), exportId: brandString<BidExportId>('export:t1'), docxPath: 'bid-t1.docx', pages: 42 }
    expect(result.value).toEqual({ artifact })
    expect(text(result)).toContain('Exported bid to bid-t1.docx (42 pages).')
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'bid/export-produced')!.data.artifact).toEqual(artifact)
  })

  it('rejects an empty tenderId before calling the service', async () => {
    const ctx = await setup()
    const agent = agentWithSession('export-reject')
    const result = await callTool(ctx, 'bid_export', { tenderId: '' }, { agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid export request: `tenderId` must be a non-empty string')
    expect(agent.session.snapshotEvents().some(e => e.type === 'bid/export-produced')).toBe(false)
  })

  it('presents with a stable title', async () => {
    const ctx = await setup()
    const args = { tenderId: brandString<TenderId>('t1') }
    expect(ctx.tools.get('bid_export')!.presentCall?.(args))
      .toEqual({ card: 'generic', title: 'Export bid', kind: 'other', rawInput: args })
  })
})

describe('tool-bid plugin shape', () => {
  it('rejects a non-agent caller (no owning session)', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'bid_parse_tender', { path: 'tenders/d.docx', title: 'fixture' }, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('bid_parse_tender requires an owning agent session')
    expect(parseCalls).toBe(0)
  })

  it('unregisters every tool when its contributing fiber is disposed (HMR-safety)', async () => {
    process.env.BID_TEST_TOKEN = 'hmr-token'
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await ctx.plugin(BidService, { apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', maxTenderBytes: 1048576, maxExportBytes: 1048576 })
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'test',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: () => Promise.reject(new Error('unused test provider')),
    })
    const fiber = await ctx.plugin(tool, {
      readChunkBytes: 65536, subagentProvider: 'test', maxConcurrentSections: 2,
    })
    expect(ctx.tools.schemas().some(s => s.name === 'bid_parse_tender')).toBe(true)
    expect(ctx.tools.schemas().some(s => s.name === 'bid_export')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'bid_parse_tender')).toBe(false)
    expect(ctx.tools.schemas().some(s => s.name === 'bid_export')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-bid')
    expect(tool.inject).toEqual(['tools', 'sessionProjections', 'bid', 'fs', 'jobs', 'subagents'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-bid')
    expect(unwrapped.inject).toEqual(['tools', 'sessionProjections', 'bid', 'fs', 'jobs', 'subagents'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})

describe('bid/* events', () => {
  it('isolate the log from later mutation', () => {
    const session = Session.create(SessionId('b1'))
    session.append('turn/start', { turn: 1 })
    const tender: BidTender = { tenderId: brandString<TenderId>('tender:x'), title: 'fixture', sectionCount: 0 }
    session.append('bid/tender-loaded', { tender })
    const event = session.snapshotEvents().findLast(e => e.type === 'bid/tender-loaded')!
    tender.title = 'fixture'
    expect(event.data.tender).toEqual({ tenderId: brandString<TenderId>('tender:x'), title: 'fixture', sectionCount: 0 })
  })

  it('do not add a derived message or surface node', () => {
    const session = Session.create(SessionId('b2'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'q' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const before = session.deriveMessages().length
    session.append('bid/section-generated', { section: { tenderId: brandString<TenderId>('t'), sectionId: brandString<SectionId>('s'), title: 't', status: 'draft' } })
    expect(session.deriveMessages()).toHaveLength(before)
    expect(session.surface.nodes).not.toContain(session.seq - 1)
  })

  it('round-trip through a seeded replay identically', () => {
    const original = Session.create(SessionId('b3'))
    original.append('turn/start', { turn: 1 })
    original.append('bid/export-produced', { artifact: { tenderId: brandString<TenderId>('t'), exportId: brandString<BidExportId>('e'), docxPath: 'b.docx', pages: 1 } })
    original.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const replayed = Session.create(SessionId('b3-replay'), original.snapshotEvents())
    expect(replayed.snapshotEvents().findLast(e => e.type === 'bid/export-produced')!.data.artifact)
      .toEqual({ tenderId: brandString<TenderId>('t'), exportId: brandString<BidExportId>('e'), docxPath: 'b.docx', pages: 1 })
    expect(replayed.snapshotEvents(SessionLogOffset(0), original.seq)).toEqual(original.snapshotEvents())
    expect(replayed.firstLiveSeq).toBe(original.seq)
  })
})
