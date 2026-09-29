/**
 * Workflow gate for the bidding tools: a `tools/pre-execute` guard that denies
 * the tender-scoped bid tools until their tender has been parsed, so the model
 * cannot match, draft, or export a tender it never loaded. It reads the
 * maintained `bidTender` projection (never the raw event log), so a parse from
 * either the tool or the `/bid` command satisfies the gate and survives resume.
 * @module @deepseek-ai/dsh-bid-guard
 */

export const name = 'bid-guard'
export const inject = ['tools', 'sessionProjections']

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-bid'

/**
 * The tender-scoped bid tools, each of which needs a parsed tender first. The
 * parse-then-work order is a domain invariant, not a deployment tunable, so it
 * is fixed here rather than exposed as configuration.
 */
const REQUIRES_PARSED_TENDER: readonly string[] = [
  'bid_match_capabilities',
  'bid_generate_section',
  'bid_generate_bid',
  'bid_export',
]

/**
 * The trimmed `tenderId` argument of a tool call, when it carries one. The
 * trim matches the gated tools' own `requireField` semantics so the gate and
 * the tool agree on the identity being compared.
 */
function tenderIdOf(exec: ToolExecution): string | undefined {
  // Dispatch arguments are frozen untyped JSON; schema validation admits only
  // objects, so the defensive non-object arm is unreachable in a live dispatch.
  /* v8 ignore next -- schema-validated dispatches always carry object arguments */
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  const value = (exec.arguments as { tenderId?: unknown }).tenderId
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * Install the pre-execute workflow gate.
 * @param ctx - context carrying the tool registry and the projection reader.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!REQUIRES_PARSED_TENDER.includes(exec.name)) return next()
    // Defer the missing-argument and subject-less cases to the tool's own
    // validation, which reports them more precisely than a workflow gate can.
    const tenderId = tenderIdOf(exec)
    if (tenderId === undefined) return next()
    const session = exec.agent?.session
    if (session === undefined) return next()
    const tender = ctx.sessionProjections.stateOf(session, 'bidTender')
    // An unregistered projection is a composition error, not a workflow state:
    // name the missing plugin so the session log distinguishes the two denials.
    if (tender === undefined) {
      return {
        kind: 'deny',
        reason: 'bid workflow gate: the "bidTender" projection is not registered (mount @deepseek-ai/dsh-tool-bid)',
      }
    }
    // The gated call must target the tender the session most recently parsed;
    // `bidTender` is null before the first parse, so an unparsed tender denies.
    if (tender?.tenderId === tenderId) {
      if (exec.name !== 'bid_generate_section' || tender.sections === undefined) return next()
      const sectionId = typeof exec.arguments === 'object' && exec.arguments !== null
        ? (exec.arguments as { sectionId?: unknown }).sectionId
        : undefined
      if (typeof sectionId !== 'string' || tender.sections.some(section => section.sectionId === sectionId.trim())) {
        return next()
      }
      return {
        kind: 'deny',
        reason: `bid_generate_section sectionId "${sectionId}" is not in the loaded tender manifest`,
      }
    }
    return {
      kind: 'deny',
      reason: `${exec.name} needs a parsed tender: call bid_parse_tender for tenderId "${tenderId}" first`,
    }
  })
}
