/** Deterministic loopback central bid REST fixture for the bid-web snapshot. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'

const exportDocx = new URL('../../../packages/bundle/web-app/tests/fixtures/document-conversion.docx', import.meta.url)

/** Running fixture endpoint and lifecycle handle. */
export interface BidRestFixture {
  readonly url: string
  close(): Promise<void>
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>
}

/** Start an OS-assigned loopback listener and return its deterministic API base URL. */
export async function startBidRestFixture(): Promise<BidRestFixture> {
  const docx = await readFile(exportDocx)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    if (request.headers.authorization !== 'Bearer snapshot-token') {
      response.writeHead(401).end('unauthorized')
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/tenders/parse') {
      for await (const _chunk of request) { /* consume the uploaded tender */ }
      json(response, {
        tenderId: 'tender:snapshot', title: url.searchParams.get('title'), sectionCount: 1,
        sections: [{ sectionId: 'approach', title: 'Technical approach' }],
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/match') {
      const requestBody = await body(request)
      json(response, { tenderId: requestBody.tenderId, matched: 7, gaps: 1, risks: ['Delivery timetable'] })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/sections/generate') {
      const requestBody = await body(request)
      json(response, { tenderId: requestBody.tenderId, sectionId: requestBody.sectionId, title: 'Technical approach', status: 'draft' })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/export') {
      const requestBody = await body(request)
      json(response, { tenderId: requestBody.tenderId, exportId: 'export:snapshot', downloadPath: 'exports/snapshot.docx', pages: 1 })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/exports/snapshot.docx') {
      response.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-length': String(docx.byteLength),
      })
      response.end(docx)
      return
    }
    response.writeHead(404).end('not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}/api/`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}
