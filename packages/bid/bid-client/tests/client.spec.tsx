// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BidProjects } from '../src/client/BidProjects.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: keyof typeof en, values?: Record<string, string | number>): string => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), en[key])
describe('BidProjects', () => {
  it('renders projects and opens the associated Session', async () => {
    const sessionId = brandString<SessionId>('session-1')
    const openSession = vi.fn()
    render(<BidProjects listProjects={async () => [{ projectId: 'p1', title: 'Metro', sessionId, status: 'generating', completedSections: 2, totalSections: 5, updatedAt: '2026-09-24T00:00:00Z' }]} openSession={openSession} t={t as never} usePanelInfo={vi.fn() as never} useSessions={vi.fn() as never} useSessionStatus={vi.fn() as never} useSessionRetainInfo={vi.fn() as never} useWorkspaces={vi.fn() as never} useResource={vi.fn() as never} />)
    expect(await screen.findByText('Metro')).toBeTruthy()
    expect(screen.getByText('2 of 5 sections')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue Session' }))
    expect(openSession).toHaveBeenCalledWith(sessionId)
  })

  it('renders failure and empty states', async () => {
    const props = {
      openSession: vi.fn(), t: t as never, usePanelInfo: vi.fn() as never,
      useSessions: vi.fn() as never, useSessionStatus: vi.fn() as never,
      useSessionRetainInfo: vi.fn() as never, useWorkspaces: vi.fn() as never,
      useResource: vi.fn() as never,
    }
    const { rerender } = render(<BidProjects {...props} listProjects={async () => { throw new Error('offline') }} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load bid projects.')
    rerender(<BidProjects {...props} listProjects={async () => []} />)
    await waitFor(() => { expect(screen.getByText('No bid projects yet.')).toBeTruthy() })
  })
})
