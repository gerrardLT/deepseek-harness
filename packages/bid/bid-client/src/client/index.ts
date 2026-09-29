/** Browser registration for bid conversation cards and the global project panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import bidProjectsRemote from '@deepseek-ai/dsh-bid-client/remote'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BidProjects, type BidProjectsInjected } from './BidProjects.tsx'
import { BidProjectsIcon } from './BidProjectsIcon.tsx'
import { bidEventDefinition, BidEventCard } from './bid-cards.tsx'
import { en, NS, zh } from './locales.ts'

/** Stable root-panel identifier for central bid projects. */
export const PANEL_ID = 'bid-projects' as MainPanelId
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'uiWorkspace']

/** Register the bid-only Remote namespace, global project navigation, and replayable bid cards. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const existing = ctx.get('remote.bidProjects')
  const disposeRemote = existing === undefined
    ? await ctx.remote.$mount(bidProjectsRemote)
    : async () => {}
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bid-client: dictionaries')
  ctx.effect(() => ctx.uiConversation.events.register(bidEventDefinition), 'bid-client: conversation definition')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'bid-event', locale: NS,
  }, BidEventCard))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    inject: (): BidProjectsInjected => ({
      listProjects: async (signal) => {
        const result = await ctx.remote.bidProjects.list(signal)
        if (!result.ok) throw result.error
        return result.value
      },
      openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
    }),
  }, BidProjects))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('type.label'), locale: NS,
  }, BidProjectsIcon))
  return disposeRemote
}
