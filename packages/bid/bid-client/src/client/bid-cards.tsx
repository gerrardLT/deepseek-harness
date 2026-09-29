/** Pure bid-card projection from durable bid events and persisted tool result metadata. */
import type { ReactNode } from 'react'
import type { BidExport, BidMatch, BidSection, BidTender } from '@deepseek-ai/dsh-bid/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationMatchResult, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type BidCardData =
  | { readonly kind: 'tender'; readonly tender: BidTender; readonly resultMeta?: BidResultMeta }
  | { readonly kind: 'match'; readonly match: BidMatch; readonly resultMeta?: BidResultMeta }
  | { readonly kind: 'section'; readonly section: BidSection; readonly resultMeta?: BidResultMeta }
  | { readonly kind: 'export'; readonly artifact: BidExport; readonly resultMeta?: BidResultMeta }

type BidResultKind = BidCardData['kind']
interface BidResultMeta {
  readonly version: 1
  readonly kind: BidResultKind
  readonly id: string
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'bid-event': BidCardData }
}

function resultMeta(value: unknown): BidResultMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || candidate.id.length === 0) return undefined
  if (candidate.kind !== 'tender' && candidate.kind !== 'match' && candidate.kind !== 'section' && candidate.kind !== 'export') return undefined
  return { version: 1, kind: candidate.kind, id: candidate.id }
}

function domainData(event: Parameters<ConversationNodeDefinition['match']>[0]): BidCardData | undefined {
  switch (event.type) {
    case 'bid/tender-loaded': return { kind: 'tender', tender: event.data.tender }
    case 'bid/capability-matched': return { kind: 'match', match: event.data.match }
    case 'bid/section-generated': return { kind: 'section', section: event.data.section }
    case 'bid/export-produced': return { kind: 'export', artifact: event.data.artifact }
    default: return undefined
  }
}

function identity(data: BidCardData): string {
  switch (data.kind) {
    case 'tender': return `bid:tender:${data.tender.tenderId}`
    case 'match': return `bid:match:${data.match.tenderId}`
    case 'section': return `bid:section:${data.section.tenderId}:${data.section.sectionId}`
    case 'export': return `bid:export:${data.artifact.exportId}`
  }
}

function matchOf(event: Parameters<ConversationNodeDefinition['match']>[0]): ConversationMatchResult | null {
  const data = domainData(event)
  if (data !== undefined) return { id: identity(data), role: 'start' }
  if (event.type !== 'tool/result') return null
  const meta = resultMeta(event.data.meta)
  return meta === undefined ? null : { id: meta.id, role: 'update' }
}

/** One visible card for each durable bid domain event, enriched by its correlated tool result metadata. */
export const bidEventDefinition: ConversationNodeDefinition<BidCardData> = {
  kind: 'bid-event', target: 'chat',
  match: matchOf,
  start: (_context, match) => domainData(match.event) as BidCardData,
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const meta = resultMeta(match.event.data.meta)
    if (meta === undefined || meta.kind !== context.state.kind) return context.state
    return { ...context.state, resultMeta: meta } as BidCardData
  },
  buildViewNode: (context) => {
    const start = context.start ?? context.matches[0]
    if (start === undefined || context.state === undefined) return null
    return { key: context.key, kind: 'bid-event', id: context.id, target: 'chat', anchorSeq: start.event.seq, location: start.location, visibility: 'visible', data: context.state } satisfies ChatNode<'bid-event'>
  },
}

/** Render one localized bid domain summary card. */
export function BidEventCard({ node, t }: PropsRuntime<'conversation.chat.node', 'bid-event'> & PropsLocale<'bidProjects'>): ReactNode {
  const data = node.data
  const title = t(`card.${data.kind}.title`)
  const detail = data.kind === 'tender' ? t('card.tender.detail', { title: data.tender.title, count: data.tender.sectionCount })
    : data.kind === 'match' ? t('card.match.detail', { matched: data.match.matched, gaps: data.match.gaps })
      : data.kind === 'section' ? t('card.section.detail', { title: data.section.title, status: data.section.status })
        : t('card.export.detail', { path: data.artifact.docxPath, pages: data.artifact.pages })
  return <section aria-label={title}><strong>{title}</strong><p>{detail}</p></section>
}
