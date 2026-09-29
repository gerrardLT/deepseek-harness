// Proves the plugin mounts through the REAL Loader from a cordis.yml — with the
// bid REST seam it now injects — and the registered tool works end to end in
// that composition: bid_parse_tender delegates to ctx.bid, which reaches a local
// node:http mock of the central service, and the returned summary lands on the
// session log. This is the shipping entry path, not a hand-assembled Context.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import BidService from '@deepseek-ai/dsh-bid'
import * as ToolBid from '@deepseek-ai/dsh-tool-bid'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined
let server: Server
let base: string

beforeEach(async () => {
  process.env.BID_TEST_TOKEN = 'loader-token'
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://localhost')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ tenderId: 'tender:uploaded', title: url.searchParams.get('title'), sections: [], sectionCount: 0 }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  delete process.env.BID_TEST_TOKEN
  root = undefined
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('bid-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: unsupportedInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

/** Boot a cordis.yml mounting the bid REST seam and the bid tool beside their services. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-bid-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${root}`,
    "- name: '@deepseek-ai/dsh-jobs-local'",
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: 'test:subagent-provider'",
    "- name: '@deepseek-ai/dsh-bid'",
    '  config:',
    `    apiBaseUrl: ${base}`,
    '    tokenEnv: BID_TEST_TOKEN',
    '    maxTenderBytes: 1048576',
    '    maxExportBytes: 1048576',
    "- name: '@deepseek-ai/dsh-tool-bid'",
    '  config:',
    '    readChunkBytes: 65536',
    '    subagentProvider: loader-test',
    '    maxConcurrentSections: 2',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const testProvider = {
    name: 'test:subagent-provider',
    inject: ['subagents'],
    apply(inner: Context) {
      const provider: SubagentProvider = {
        name: 'loader-test',
        capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.reject(new Error('unused loader provider')),
      }
      inner.subagents.registerProvider(provider)
    },
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-jobs-local', LocalJobRegistry],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['test:subagent-provider', testProvider],
    ['@deepseek-ai/dsh-bid', BidService],
    ['@deepseek-ai/dsh-tool-bid', ToolBid],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

describe('tool-bid real Loader composition through cordis.yml', () => {
  it('registers bid_parse_tender and appends the service summary end to end', async () => {
    const ctx = await boot()
    if (root === undefined) throw new Error('test root missing')
    await writeFile(join(root, 'tenders', 'real.docx'), Uint8Array.of(1), { flush: true }).catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(root!, 'tenders'), { recursive: true })
      await writeFile(join(root!, 'tenders', 'real.docx'), Uint8Array.of(1))
    })
    expect(ctx.tools.schemas().some(s => s.name === 'bid_parse_tender')).toBe(true)
    expect(ctx.bid).toBeInstanceOf(BidService)

    const owner = await agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('parse-1'),
      name: 'bid_parse_tender',
      arguments: { path: 'tenders/real.docx', title: '真实加载' },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(owner.session.snapshotEvents().findLast(e => e.type === 'bid/tender-loaded')?.data.tender)
      .toEqual({ tenderId: 'tender:uploaded', title: '真实加载', sections: [], sectionCount: 0 })
  }, 30_000)
})
