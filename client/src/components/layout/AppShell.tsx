/**
 * AppShell — the outer layout wrapper for authenticated pages.
 *
 * Structure:
 *   <html>
 *     <Sidebar (220px, fixed height) />
 *     <main (flex-1, scrollable)>
 *       <Topbar (56px, sticky) />
 *       <content area (flex-1, overflow-auto) />
 *     </main>
 *   </html>
 *
 * #root is set to { display: flex; height: 100vh; overflow: hidden } in index.css,
 * so this component just fills that container.
 */

import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { AsJobTracker } from './AsJobTracker'

interface AppShellProps {
  title: string
  actions?: ReactNode
  children: ReactNode
  /** Prevent the content area from scrolling (for the grid editor which handles its own scroll) */
  noScroll?: boolean
}

export function AppShell({ title, actions, children, noScroll }: AppShellProps) {
  return (
    <>
      <AsJobTracker />
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar title={title} actions={actions} />
        <main
          className={[
            'flex-1',
            noScroll ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-6',
          ].join(' ')}
          style={{ background: 'var(--bg)' }}
        >
          {children}
        </main>
      </div>
    </>
  )
}
