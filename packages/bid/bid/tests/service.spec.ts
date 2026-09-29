import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import BidService from '@deepseek-ai/dsh-bid'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { BidTender } from '@deepseek-ai/dsh-bid'

let server: Server
let base: string
let status: number
let body: unknown
let rawBody: string | undefined

beforeEach(async () => {
  status = 200
  body = {}
  rawBody = undefined
  process.env.BID_TEST_TOKEN = 'jwt-test'
  server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(rawBody ?? JSON.stringify(body))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  delete process.env.BID_TEST_TOKEN
})

async function mount(): Promise<BidService> {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(BidService, { apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', maxTenderBytes: 1024, maxExportBytes: 1048576 })
  return ctx.bid
}

describe('BidService REST client', () => {
  it('posts and validates a tender summary', async () => {
    const tender: BidTender = { tenderId: 't1' as BidTender['tenderId'], title: 'Road tender', sections: [], sectionCount: 0 }
    body = tender
    await expect((await mount()).parseTender({ name: 'a.docx', title: tender.title, bytes: 1, data: (async function* () { yield Uint8Array.of(1) })() })).resolves.toEqual(tender)
  })

  it('rejects missing credentials at load', async () => {
    delete process.env.BID_TEST_TOKEN
    const ctx = new Context()
    try {
      expect(() => new BidService(ctx, {
        apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', timeoutMs: 1,
        maxTenderBytes: 1024, maxExportBytes: 1048576,
      })).toThrow('token environment variable BID_TEST_TOKEN must have a nonempty value')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid timeoutMs %s at load', async (timeoutMs) => {
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(BidService, {
      apiBaseUrl: base, tokenEnv: 'BID_TEST_TOKEN', timeoutMs,
      maxTenderBytes: 1024, maxExportBytes: 1048576,
    })).rejects.toThrow('timeoutMs must be a positive safe integer')
  })

  it('rejects malformed successful responses', async () => {
    body = { tenderId: 't1', title: 'Road tender', sections: [], sectionCount: 1 }
    await expect((await mount()).parseTender({ name: 'a.docx', title: 'Road tender', bytes: 1, data: (async function* () { yield Uint8Array.of(1) })() }))
      .rejects.toThrow('returned an invalid response')
  })

  it('rejects a response for a different tender', async () => {
    body = { tenderId: 'other', matched: 1, gaps: 0, risks: [] }
    await expect((await mount()).matchCapabilities({ tenderId: 'requested' as never }))
      .rejects.toThrow('returned a different tenderId')
  })

  it('contextualizes invalid JSON responses', async () => {
    rawBody = '<html>bad gateway</html>'
    await expect((await mount()).parseTender({ name: 'a.docx', title: 'Road tender', bytes: 1, data: (async function* () { yield Uint8Array.of(1) })() }))
      .rejects.toThrow('bid REST tenders/parse returned an invalid response')
  })

  it('gets and validates central project summaries', async () => {
    body = [{
      projectId: 'p1', title: 'Tender project', sessionId: 's1', status: 'generating',
      completedSections: 2, totalSections: 5, updatedAt: '2026-09-24T10:00:00Z',
    }]
    await expect((await mount()).listProjects()).resolves.toEqual(body)
  })

  it('rejects malformed project progress', async () => {
    body = [{
      projectId: 'p1', title: 'Tender project', status: 'generating',
      completedSections: -1, totalSections: 5, updatedAt: 'not-a-date',
    }]
    await expect((await mount()).listProjects()).rejects.toThrow('bid REST projects returned an invalid response')
  })

  it('reports non-success responses', async () => {
    status = 500
    body = { error: 'boom' }
    await expect((await mount()).parseTender({ name: 'a.docx', title: 'Road tender', bytes: 1, data: (async function* () { yield Uint8Array.of(1) })() }))
      .rejects.toThrow('bid REST tenders/parse failed with status 500')
  })

  it('honors caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect((await mount()).parseTender({ name: 'a.docx', title: 'Road tender', bytes: 1, data: (async function* () { yield Uint8Array.of(1) })() }, controller.signal)).rejects.toThrow()
  })

  it('rejects non-HTTP base URLs', async () => {
    const ctx = new Context()
    try {
      expect(() => new BidService(ctx, {
        apiBaseUrl: 'ftp://bid.internal', tokenEnv: 'BID_TEST_TOKEN', timeoutMs: 1,
        maxTenderBytes: 1024, maxExportBytes: 1048576,
      })).toThrow('apiBaseUrl must use http or https')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
