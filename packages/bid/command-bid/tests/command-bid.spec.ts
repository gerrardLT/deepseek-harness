import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import BidService from '@deepseek-ai/dsh-bid'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import * as commandBid from '@deepseek-ai/dsh-command-bid'

// A local mock of the central bid REST service. Any request whose body carries
// the token `boom` fails, to exercise the handler's error propagation.
let server: Server
let base: string
let lastRequest: { url: string; body: string }

beforeAll(async () => {
  server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/exports/')) {
      res.writeHead(200, { 'content-length': '3' })
      res.end(Buffer.from([1, 2, 3]))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      lastRequest = { url: req.url ?? '', body }
      if (body.includes('boom')) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'boom' }))
        return
      }
      const url = req.url ?? ''
      const parsed = url.includes('/tenders/parse') ? {} : JSON.parse(body) as Record<string, string>
      let responseBody: Record<string, unknown>
      if (url.includes('/tenders/parse')) {
        const query = new URL(url, 'http://localhost').searchParams
        responseBody = { tenderId: 'tender:uploaded', title: query.get('title'), sections: [], sectionCount: 0 }
      } else if (url.endsWith('/match')) {
        responseBody = { tenderId: parsed.tenderId, matched: 8, gaps: 1, risks: ['deadline'] }
      } else if (url.endsWith('/sections/generate')) {
        responseBody = { tenderId: parsed.tenderId, sectionId: parsed.sectionId, title: parsed.sectionId, status: 'draft' }
      } else {
        responseBody = { tenderId: parsed.tenderId, exportId: `export:${parsed.tenderId}`, downloadPath: `exports/${parsed.tenderId}.docx`, pages: 42 }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(responseBody))
    })
  })
  base = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`) })
  })
})

afterAll(async () => { await new Promise<void>(resolve => server.close(() => { resolve() })) })
afterEach(() => { delete process.env.BID_DELEGATION_TOKEN })

async function harness(): Promise<{ ctx: Context; agent: Agent; session: Session }> {
  process.env.BID_TEST_TOKEN = 'command-token'
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-command-bid-'))
  const ctx = new Context()
  ctx.effect(() => () => rm(workspace, { recursive: true, force: true }))
  await ctx.plugin(CommandRuntime)
  class TestAttachments extends AttachmentStore {
    readonly imageLimits = {
      maxImageBytes: 1,
      maxImagesPerMessage: 1,
      maxMessageImageBytes: 1,
      maxImagePixels: 1,
      maxImageDimension: 1,
      mediaTypes: [],
    }
    validateImage(): Promise<void> { return Promise.resolve() }
    saveImage(): Promise<never> { return Promise.reject(new Error('unused')) }
    readImage(): Promise<never> { return Promise.reject(new Error('unused')) }
    override async *readFileStream(): AsyncIterable<Uint8Array> { yield Uint8Array.of(1) }
  }
  await ctx.plugin(TestAttachments)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(BidService, { apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', maxTenderBytes: 1048576, maxExportBytes: 1048576 })
  await ctx.plugin(commandBid)
  const sessionId = SessionId('command-bid')
  const session = Session.create(sessionId, undefined, {
    version: 3, id: sessionId, createdAt: Date.now(), isSeeded: false, cwd: workspace,
  })
  const agent = { session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as unknown as Agent
  return { ctx, agent, session }
}

async function bid(ctx: Context, agent: Agent, line: string, attachments: readonly { type: 'file'; receiptId: string }[] = []) {
  const execution = await ctx.commands.execute(agent, line, attachments, new AbortController().signal)
  if (execution === undefined) throw new Error('the /bid command was not registered')
  return execution.result
}

describe('command-bid /bid', () => {
  it('parse runs the tender parse, logs the event, and points the result at it', async () => {
    const { ctx, agent, session } = await harness()
    const file: FileAttachmentRef = { attachmentId: 'file-id' as FileAttachmentRef['attachmentId'], name: 'tender.docx', bytes: 1 }
    const disposeReceipt = ctx.commands.registerFileReceiptResolver((_agent, receiptId) => receiptId === 'receipt-1' ? file : undefined)
    const result = await bid(ctx, agent, '/bid parse fixture', [{ type: 'file', receiptId: 'receipt-1' }])
    expect(result.kind).toBe('success')
    expect(lastRequest.url).toContain('/api/tenders/parse?')
    expect(lastRequest.url).toContain('title=fixture')
    expect(lastRequest.body).toBe(String.fromCharCode(1))
    const event = session.snapshotEvents().findLast(each => each.type === 'bid/tender-loaded')!
    expect(event.data.tender.title).toBe('fixture')
    expect(result.kind === 'success' ? result.sourceEventSeq : undefined).toBe(event.seq)
    disposeReceipt()
    await ctx.fiber.dispose()
  })

  it('parse without a title returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid parse tenders/a.docx')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('parse without a path returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid parse')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('match runs and logs bid/capability-matched', async () => {
    const { ctx, agent, session } = await harness()
    expect((await bid(ctx, agent, '/bid match tender:t1')).kind).toBe('success')
    expect(lastRequest.url).toBe('/api/match')
    expect(session.snapshotEvents().some(each => each.type === 'bid/capability-matched')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('match without a tenderId returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid match')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('generate runs and logs bid/section-generated', async () => {
    const { ctx, agent, session } = await harness()
    expect((await bid(ctx, agent, '/bid generate tender:t1 s2')).kind).toBe('success')
    expect(lastRequest.url).toBe('/api/sections/generate')
    expect(lastRequest.body).toContain('"sectionId":"s2"')
    expect(session.snapshotEvents().some(each => each.type === 'bid/section-generated')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('generate without a sectionId returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid generate tender:t1')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('export runs and logs bid/export-produced', async () => {
    const { ctx, agent, session } = await harness()
    const result = await bid(ctx, agent, '/bid export tender:t1')
    if (result.kind === 'error') throw new Error(result.text)
    expect(result.kind).toBe('success')
    expect(lastRequest.url).toBe('/api/export')
    expect(session.snapshotEvents().some(each => each.type === 'bid/export-produced')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('export without a tenderId returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid export')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('an unknown subcommand returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid frobnicate')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('empty input returns usage', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid')).kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('surfaces a central-service failure as an error result', async () => {
    const { ctx, agent } = await harness()
    expect((await bid(ctx, agent, '/bid match boom')).kind).toBe('error')
    await ctx.fiber.dispose()
  })
})
