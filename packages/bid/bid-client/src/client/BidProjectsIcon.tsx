/** Root-sidebar icon for the global bid projects panel. */
import type { ReactNode } from 'react'
import { IconFolderClose16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Render the bid-project glyph at the sidebar-requested size. */
export function BidProjectsIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconFolderClose16 size={size} />
}
