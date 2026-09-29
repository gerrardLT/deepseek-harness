// Proves the bid service mounts through the REAL Loader from a cordis.yml and
// that its required `apiBaseUrl` is genuine config: omitting it fails the load
// rather than constructing a client with no base URL.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as FileSystemModule from '@deepseek-ai/dsh-fs-local'
import * as BidServiceModule from '@deepseek-ai/dsh-bid'
import BidService from '@deepseek-ai/dsh-bid'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  delete process.env.BID_TEST_TOKEN
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a cordis.yml carrying the given bid config lines under `config:`. */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-bid-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-bid'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-fs-local', FileSystemModule],
    ['@deepseek-ai/dsh-bid', BidServiceModule],
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

describe('bid service through a real Loader composition', () => {
  it('registers ctx.bid from a Cordis row carrying apiBaseUrl', async () => {
    process.env.BID_TEST_TOKEN = 'loader-token'
    const ctx = await boot([
      '    apiBaseUrl: http://127.0.0.1:9/api/agent',
      '    tokenEnv: BID_TEST_TOKEN',
      '    maxTenderBytes: 104857600',
      '    maxExportBytes: 104857600',
    ])
    expect(ctx.bid).toBeInstanceOf(BidService)
  }, 30_000)

  it('fails loading when apiBaseUrl is omitted', async () => {
    await expect(boot([])).rejects.toThrow('apiBaseUrl')
  }, 30_000)
})
