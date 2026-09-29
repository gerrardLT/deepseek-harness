import { useEffect, useState, type ReactNode } from 'react'
import type { BidProjectSummary } from '@deepseek-ai/dsh-bid/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './BidProjects.module.css'

export interface BidProjectsInjected {
  readonly listProjects: (signal: AbortSignal) => Promise<BidProjectSummary[]>
  readonly openSession: (sessionId: SessionId) => void
}

type Props = PropsRuntime<'main'> & PropsLocale<'bidProjects'> & BidProjectsInjected

/** Render central bid projects and links to their associated Sessions. */
export function BidProjects({ listProjects, openSession, t }: Props): ReactNode {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; projects: BidProjectSummary[] }>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void listProjects(controller.signal).then(
      (projects) => { if (!controller.signal.aborted) setState({ kind: 'ready', projects }) },
      () => { if (!controller.signal.aborted) setState({ kind: 'error' }) },
    )
    return () => { controller.abort() }
  }, [listProjects])
  if (state.kind === 'loading') return <p className={css.state} role="status">{t('loading')}</p>
  if (state.kind === 'error') return <p className={css.state} role="alert">{t('error')}</p>
  if (state.projects.length === 0) return <p className={css.state}>{t('empty')}</p>
  return <ul className={css.list}>{state.projects.map(project => <li className={css.card} key={project.projectId}>
    <div className={css.heading}><strong>{project.title}</strong><span className={css.status}>{t(`status.${project.status}`)}</span></div>
    <progress className={css.progress} value={project.completedSections} max={Math.max(project.totalSections, 1)} aria-label={t('progress', { completed: project.completedSections, total: project.totalSections })} />
    <span className={css.progressText}>{t('progress', { completed: project.completedSections, total: project.totalSections })}</span>
    {project.sessionId !== undefined && <button className={css.action} type="button" onClick={() => { if (project.sessionId !== undefined) openSession(project.sessionId) }}>{t('continue')}</button>}
  </li>)}</ul>
}
