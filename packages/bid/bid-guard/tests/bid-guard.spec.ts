import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z as zod } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BidTender, TenderId } from '@deepseek-ai/dsh-bid'
import * as bidGuard from '@deepseek-ai/dsh-bid-guard'

const signal = new AbortController().signal
const BID_TOOLS = [
  'bid_parse_tender', 'bid_match_capabilities', 'bid_generate_section', 'bid_generate_bid', 'bid_export',
]

// A minimal bidTender projection unit so the guard's `stateOf` read resolves.
// Mirrors tool-bid's real registration: if tool-bid's projection semantics
// change (fold rule, stateVersion), update this copy to match.
const bidTenderSchema = zod.union([
  zod.object({
    tenderId: zod.string().transform(value => brandString<TenderId>(value)),
    title: zod.string(),
    sectionCount: zod.number(),
  }),
  zod.null(),
])

// A minimal stand-in for each bid tool: the guard gates by NAME and reads the
// bidTender projection, so the stubs only need to exist and report they ran.
function stub(toolName: string) {
  return defineTool({
    name: toolName,
    description: `${toolName} stub`,
    parameters: { tenderId: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return `ran:${toolName}` },
  })
}

async function harness(options?: { withProjection?: boolean }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  if (options?.withProjection !== false) {
    ctx.sessionProjections.register<'bidTender', BidTender | null>({
      key: 'bidTender',
      stateSchema: bidTenderSchema,
      init: () => null,
      apply: (state, event) => (event.type === 'bid/tender-loaded' ? event.data.tender : state),
      wire: { viewSchema: bidTenderSchema, view: state => state },
      stateVersion: 1,
    })
  }
  await ctx.plugin(bidGuard)
  for (const toolName of [...BID_TOOLS, 'echo']) ctx.tools.register(stub(toolName))
  const session = Session.create(SessionId('bid-guard'))
  const agent = { id: session.id, session, status: 'idle', options: {} } as unknown as Agent
  return { ctx, session, agent }
}

/** Log a parse for one tender, exactly as bid_parse_tender would. */
function parsed(session: Session, tenderId: string): void {
  session.append('bid/tender-loaded', {
    tender: { tenderId: brandString<TenderId>(tenderId), title: `T ${tenderId}`, sectionCount: 3 },
  })
}

async function run(ctx: Context, agent: Agent | undefined, name: string, args: Record<string, unknown>) {
  const result = await ctx.tools.execute({
    signal, callId: ToolCallId(name), name, arguments: args, ...(agent === undefined ? {} : { agent }),
  })
  const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
  return { isError: result.isError, text }
}

describe('bid-guard', () => {
  it('denies a tender-scoped tool before its tender is parsed', async () => {
    const { ctx, agent } = await harness()
    const { isError, text } = await run(ctx, agent, 'bid_match_capabilities', { tenderId: brandString<TenderId>('t1') })
    expect(isError).toBe(true)
    expect(text).toBe('Error: bid_match_capabilities needs a parsed tender: call bid_parse_tender for tenderId "t1" first')
  })

  it('denies section, whole-bid generation, and export before parse too', async () => {
    const { ctx, agent } = await harness()
    const args = { tenderId: brandString<TenderId>('t1') }
    expect((await run(ctx, agent, 'bid_generate_section', args)).isError).toBe(true)
    expect((await run(ctx, agent, 'bid_generate_bid', args)).isError).toBe(true)
    expect((await run(ctx, agent, 'bid_export', args)).isError).toBe(true)
  })

  it('allows bid_parse_tender, which is not gated', async () => {
    const { ctx, agent } = await harness()
    const { isError, text } = await run(ctx, agent, 'bid_parse_tender', {})
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_parse_tender')
  })

  it('allows a tender-scoped tool once its tender is parsed', async () => {
    const { ctx, session, agent } = await harness()
    parsed(session, 't1')
    const { isError, text } = await run(ctx, agent, 'bid_match_capabilities', { tenderId: brandString<TenderId>('t1') })
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_match_capabilities')
  })

  it('still denies a different tender than the one parsed', async () => {
    const { ctx, session, agent } = await harness()
    parsed(session, 't1')
    const { isError, text } = await run(ctx, agent, 'bid_export', { tenderId: brandString<TenderId>('t2') })
    expect(isError).toBe(true)
    expect(text).toContain('bid_export needs a parsed tender')
  })

  it('leaves non-bid tools untouched', async () => {
    const { ctx, agent } = await harness()
    const { isError, text } = await run(ctx, agent, 'echo', {})
    expect(isError).toBe(false)
    expect(text).toBe('ran:echo')
  })

  it('defers a subject-less call to the tool', async () => {
    const { ctx } = await harness()
    const { isError, text } = await run(ctx, undefined, 'bid_match_capabilities', { tenderId: brandString<TenderId>('t1') })
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_match_capabilities')
  })

  it('defers a call with no tenderId to the tool', async () => {
    const { ctx, agent } = await harness()
    const { isError, text } = await run(ctx, agent, 'bid_generate_section', {})
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_generate_section')
  })

  it('matches a tenderId carrying surrounding whitespace, like the tools trim', async () => {
    const { ctx, session, agent } = await harness()
    parsed(session, 't1')
    const { isError, text } = await run(ctx, agent, 'bid_match_capabilities', { tenderId: brandString<TenderId>(' t1 ') })
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_match_capabilities')
  })

  it('defers a whitespace-only tenderId to the tool', async () => {
    const { ctx, agent } = await harness()
    const { isError, text } = await run(ctx, agent, 'bid_export', { tenderId: brandString<TenderId>('   ') })
    expect(isError).toBe(false)
    expect(text).toBe('ran:bid_export')
  })

  it('names the missing plugin when the bidTender projection is not registered', async () => {
    const { ctx, agent } = await harness({ withProjection: false })
    const { isError, text } = await run(ctx, agent, 'bid_match_capabilities', { tenderId: brandString<TenderId>('t1') })
    expect(isError).toBe(true)
    expect(text).toContain('the "bidTender" projection is not registered')
  })
})
