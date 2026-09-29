// @vitest-environment jsdom
/** REAL browser composition through the shipped bid-web dependency cone. */
import { expect } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { bundleRoster, createClientTest } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { BidProjectSummary } from '@deepseek-ai/dsh-bid-client/types'
import type {} from '@deepseek-ai/dsh-bid-client/remote'
import * as BidClientBrowser from '../src/client/index.ts'
import { BidProjects } from '../src/client/BidProjects.tsx'
import { BidProjectsIcon } from '../src/client/BidProjectsIcon.tsx'
import { BidEventCard } from '../src/client/bid-cards.tsx'
import { PANEL_ID } from '../src/client/index.ts'

const SELF = '@deepseek-ai/dsh-bid-client'
const roster = bundleRoster(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-bid-web-profile']).closure([SELF])
const test = createClientTest({ roster, provide: { [SELF]: BidClientBrowser } })

test('composes visible bid registrations, navigation, and disposal', async ({ mock, start }) => {
  const projects: BidProjectSummary[] = [{
    projectId: 'project-1', title: 'Metro', sessionId: 'session-2' as BidProjectSummary['sessionId'], status: 'generating',
    completedSections: 2, totalSections: 5, updatedAt: '2026-09-24T00:00:00Z',
  }]
  mock.remote.bidProjects.list.mockResolvedValueOnce(ok(projects))
  const client = await start()
  await expect(client.ctx.remote.bidProjects.list()).resolves.toMatchObject({ ok: true, value: [{ title: 'Metro' }] })
  expect(client.ctx.slots.entries('main')).toEqual(expect.arrayContaining([expect.objectContaining({ component: BidProjects, options: expect.objectContaining({ key: PANEL_ID }) })]))
  expect(client.ctx.slots.entries('sidebar.panellist')).toEqual(expect.arrayContaining([expect.objectContaining({ component: BidProjectsIcon, options: expect.objectContaining({ id: PANEL_ID }) })]))
  expect(client.ctx.slots.entries('conversation.chat.node')).toEqual(expect.arrayContaining([expect.objectContaining({ component: BidEventCard, options: expect.objectContaining({ key: 'bid-event' }) })]))
  expect(client.ctx.uiConversation.events.entries().map(definition => definition.kind)).toContain('bid-event')
  const panel = client.ctx.slots.entries('main').find(entry => entry.component === BidProjects)!
  const open = (panel.inject as () => { openSession(sessionId: string): void })().openSession
  expect(() => { open('session-2') }).toThrow('sessions.retain: unknown session session-2')
  await client.unload(SELF)
  expect(client.ctx.slots.entries('main').some(entry => entry.component === BidProjects)).toBe(false)
  expect(client.ctx.slots.entries('sidebar.panellist').some(entry => entry.component === BidProjectsIcon)).toBe(false)
  expect(client.ctx.slots.entries('conversation.chat.node').some(entry => entry.component === BidEventCard)).toBe(false)
  expect(client.ctx.uiConversation.events.entries().map(definition => definition.kind)).not.toContain('bid-event')
}, 60_000)
