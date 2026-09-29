/**
 * Human `/bid` command: run one tender/bid operation directly against the
 * central service and log the same domain event the bid tools write, so the
 * projection cards update without a model turn.
 * @module @deepseek-ai/dsh-command-bid
 */

export const name = 'command-bid'
export const inject = ['commands', 'bid', 'attachments']

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SectionId, TenderId } from '@deepseek-ai/dsh-bid'
import type {} from '@deepseek-ai/dsh-attachment'

const USAGE = 'Usage: /bid <parse <title> with one file | match <tenderId> | generate <tenderId> <sectionId> | export <tenderId>>'

/** Dispatch one `/bid` invocation to its subcommand against the `ctx.bid` seam. */
async function run(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const [sub, ...rest] = invocation.rawInput.trim().split(/\s+/).filter(part => part.length > 0)
  switch (sub) {
    case 'parse': {
      const title = rest.join(' ')
      if (title.length === 0 || invocation.attachments.length !== 1) return { kind: 'error', text: USAGE }
      const attachment = invocation.attachments[0]
      if (attachment?.type !== 'file') return { kind: 'error', text: USAGE }
      const file = attachment.attachment
      const tender = await ctx.bid.parseTender({
        title,
        name: file.name,
        bytes: file.bytes,
        data: ctx.attachments.readFileStream(file, invocation.signal),
      }, invocation.signal)
      const { seq } = invocation.agent.session.append('bid/tender-loaded', { tender })
      return { kind: 'success', text: `Parsed tender ${tender.title} (${tender.sectionCount} sections).`, sourceEventSeq: seq }
    }
    case 'match': {
      if (invocation.attachments.length > 0) return { kind: 'error', text: USAGE }
      const tenderId = rest[0]
      if (tenderId === undefined || rest.length !== 1) return { kind: 'error', text: USAGE }
      const match = await ctx.bid.matchCapabilities({ tenderId: brandString<TenderId>(tenderId) }, invocation.signal)
      const { seq } = invocation.agent.session.append('bid/capability-matched', { match })
      return { kind: 'success', text: `Matched ${match.matched} capabilities, ${match.gaps} gap(s).`, sourceEventSeq: seq }
    }
    case 'generate': {
      if (invocation.attachments.length > 0) return { kind: 'error', text: USAGE }
      const tenderId = rest[0]
      const sectionId = rest[1]
      if (tenderId === undefined || sectionId === undefined || rest.length !== 2) return { kind: 'error', text: USAGE }
      const section = await ctx.bid.generateSection({
        tenderId: brandString<TenderId>(tenderId),
        sectionId: brandString<SectionId>(sectionId),
      }, invocation.signal)
      const { seq } = invocation.agent.session.append('bid/section-generated', { section })
      return { kind: 'success', text: `Generated section ${section.title} (${section.status}).`, sourceEventSeq: seq }
    }
    case 'export': {
      if (invocation.attachments.length > 0) return { kind: 'error', text: USAGE }
      const tenderId = rest[0]
      if (tenderId === undefined || rest.length !== 1) return { kind: 'error', text: USAGE }
      const artifact = await ctx.bid.exportBid({
        tenderId: brandString<TenderId>(tenderId),
        session: invocation.agent.session,
        destination: `bid-${tenderId.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.docx`,
      }, invocation.signal)
      const { seq } = invocation.agent.session.append('bid/export-produced', { artifact })
      return { kind: 'success', text: `Exported bid to ${artifact.docxPath} (${artifact.pages} pages).`, sourceEventSeq: seq }
    }
    default: return { kind: 'error', text: USAGE }
  }
}

/**
 * Register `/bid` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the `ctx.bid` seam.
 */
export function apply(ctx: Context): void {
  // In-flight operations. The drain is yielded before the registration, so LIFO
  // teardown unregisters first — no new invocation enters while already-started
  // operations quiesce, and a teardown cannot strand a long generate/export call.
  const active = new Set<Promise<CommandResult>>()
  const disposal = new AbortController()
  ctx.effect(function* () {
    yield async () => {
      disposal.abort('command-bid plugin disposed')
      await Promise.allSettled(active)
    }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-bid'),
      name: 'bid',
      description: 'Run a tender/bid operation directly: parse, match, generate, or export',
      input: { hint: 'parse <title> | match <tenderId> | generate <tenderId> <sectionId> | export <tenderId>', attachments: true },
      handler: (invocation: CommandInvocation): Promise<CommandResult> => {
        const signal = AbortSignal.any([invocation.signal, disposal.signal])
        const ownedInvocation: CommandInvocation = { ...invocation, signal }
        // A central-service or append failure renders as a human error result
        // rather than rejecting the dispatch, so the composer shows it inline.
        const operation = run(ctx, ownedInvocation).catch((error: unknown): CommandResult => {
          /* v8 ignore next -- a non-Error rejection cannot come from the typed ctx.bid seam */
          return { kind: 'error', text: error instanceof Error ? error.message : 'bid command failed' }
        })
        active.add(operation)
        void operation.then(() => { active.delete(operation) })
        return operation
      },
    })
  }, 'command-bid lifecycle')
}
