/** The bid Web bundle must carry one exact, Loader-compatible domain layer. */

import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as yaml from 'js-yaml'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader, { evaluate } from '@deepseek-ai/cordis-plugin-loader'

interface JsExpression { __jsExpr?: string }
interface Row {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

let application: Context | undefined
let temporaryRoot: string | undefined

afterEach(async () => {
  await application?.fiber.dispose()
  application = undefined
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('bid Web profile bundle', () => {
  it('declares the exact domain package composition without base-provided dependencies', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@deepseek-ai/dsh-bid',
      '@deepseek-ai/dsh-bid-client',
      '@deepseek-ai/dsh-bid-guard',
      '@deepseek-ai/dsh-command-bid',
      '@deepseek-ai/dsh-tool-bid',
    ])

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('bid Web patch must parse to a patch list')
    const rows = parsed.flatMap(patch => (patch as { insert?: Row[] }).insert ?? [])
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['bid', '@deepseek-ai/dsh-bid'],
      ['tool-bid', '@deepseek-ai/dsh-tool-bid'],
      ['command-bid', '@deepseek-ai/dsh-command-bid'],
      ['bid-guard', '@deepseek-ai/dsh-bid-guard'],
      ['bid-client', '@deepseek-ai/dsh-bid-client'],
    ])
  })

  it('activates all five profile injections through a real Loader application', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bid-profile-loader-'))
    const configPath = join(temporaryRoot, 'cordis.yml')
    await writeFile(configPath, [
      "- name: 'test:bid'",
      "- name: 'test:tool-bid'",
      "- name: 'test:command-bid'",
      "- name: 'test:bid-guard'",
      "- name: 'test:bid-client'",
      '',
    ].join('\n'))
    const activated: string[] = []
    const ctx = new Context()
    application = ctx
    ctx.baseUrl = pathToFileURL(temporaryRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map(([
      ['test:bid', 'bid'],
      ['test:tool-bid', 'tool-bid'],
      ['test:command-bid', 'command-bid'],
      ['test:bid-guard', 'bid-guard'],
      ['test:bid-client', 'bid-client'],
    ] satisfies [string, string][]).map(([specifier, id]) => [specifier, {
      name: id,
      apply(inner: Context) {
        activated.push(id)
        inner.effect(() => () => activated.splice(activated.indexOf(id), 1))
      },
    }]))
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const plugin = modules.get(specifier)
        if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return plugin
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()
    expect(activated).toEqual(['bid', 'tool-bid', 'command-bid', 'bid-guard', 'bid-client'])
    await ctx.fiber.dispose()
    application = undefined
    expect(activated).toEqual([])
  })

  it('loads deployment values from environment expressions without embedding secrets', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const source = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(source).not.toMatch(/Bearer\s|eyJ[A-Za-z0-9_-]*\./)
    const parsed = yaml.load(source, { schema: entryListSchema }) as { insert?: Row[] }[]
    const rows = parsed.flatMap(patch => patch.insert ?? [])
    const bid = rows.find(row => row.id === 'bid')
    const tool = rows.find(row => row.id === 'tool-bid')
    const env = {
      BID_API_BASE_URL: 'https://bid.example/api/',
      BID_TOKEN_ENV: 'SECRET_TOKEN_NAME',
      BID_SERVICE_TOKEN_ENV: 'SERVICE_SECRET_NAME',
      BID_DELEGATION_SUBJECT: 'enterprise-user',
      BID_MAX_TENDER_BYTES: '101',
      BID_MAX_EXPORT_BYTES: '202',
      BID_TIMEOUT_MS: '303',
      BID_READ_CHUNK_BYTES: '404',
      BID_SUBAGENT_PROVIDER: 'fork',
      BID_MAX_CONCURRENT_SECTIONS: '5',
    }
    const value = (field: unknown) => evaluate({ process: { env } }, (field as JsExpression).__jsExpr!)
    expect(Object.fromEntries(Object.entries(bid!.config!).map(([key, field]) => [key, value(field)]))).toEqual({
      apiBaseUrl: 'https://bid.example/api/',
      tokenEnv: 'SECRET_TOKEN_NAME',
      serviceTokenEnv: 'SERVICE_SECRET_NAME',
      delegationSubject: 'enterprise-user',
      maxTenderBytes: 101,
      maxExportBytes: 202,
      timeoutMs: 303,
    })
    expect(Object.fromEntries(Object.entries(tool!.config!).map(([key, field]) => [key, value(field)]))).toEqual({
      readChunkBytes: 404,
      subagentProvider: 'fork',
      maxConcurrentSections: 5,
    })
  })
})
