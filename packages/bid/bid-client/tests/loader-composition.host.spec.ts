/** REAL Host composition for the generated bidProjects Remote. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import BidService from '@deepseek-ai/dsh-bid'
import * as TypertLoader from '@deepseek-ai/dsh-typert-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import BidClient from '../src/index.ts'

const SELF = '@deepseek-ai/dsh-bid-client'
const BID = '@deepseek-ai/dsh-bid'
let root: string | undefined
let host: Context | undefined

afterEach(async () => {
  await host?.fiber.dispose()
  host = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('bid-client Host REAL composition', () => {
  test('registers the generated bidProjects Remote through Loader', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-bid-client-composition-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: \'@deepseek-ai/dsh-typert-registry\'',
      '- name: \'@deepseek-ai/dsh-typert-loader\'',
      '  config:',
      `    packages: ['${SELF}']`,
      `- name: '${BID}'`,
      '  config:',
      '    apiBaseUrl: \'https://bid.invalid/api/agent\'',
      '    tokenEnv: \'BID_TEST_TOKEN\'',
      '    maxTenderBytes: 1024',
      '    maxExportBytes: 1024',
      `- name: '${SELF}'`,
      '',
    ].join('\n'))
    vi.stubEnv('BID_TEST_TOKEN', 'delegated')
    vi.stubGlobal('fetch', vi.fn())
    host = new Context()
    host.baseUrl = `${pathToFileURL(root).href}/`
    await host.plugin(Loader)
    host.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
      ['@deepseek-ai/dsh-typert-loader', TypertLoader],
      [BID, BidService],
      [SELF, BidClient],
    ])
    host.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return module
      },
    } as unknown as NonNullable<typeof host.loader.internal>
    await host.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await host.loader.await()
    expect(host.typert.local.list().map(row => row.namespace)).toContain('bidProjects')
  }, 60_000)
})
