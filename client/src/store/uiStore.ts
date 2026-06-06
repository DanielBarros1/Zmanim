/**
 * UI Store — client-only UI state that doesn't need to be on the server.
 *
 * Dark mode: persisted to localStorage, applied as data-theme="dark" on <html>.
 * Active day: which day tab is visible in the schedule editor.
 * Sidebar: collapsible; collapsed state persisted to localStorage.
 */

import { create } from 'zustand'
import { Day } from '@zmanim/shared'

/** Background AS job being tracked globally (survives modal close + page refresh). */
export interface ActiveAsJob {
  jobId: string
  name: string
  startedAt: number  // Date.now() when the job was started
}

interface UIState {
  // Dark mode
  isDark: boolean
  toggleDark: () => void

  // Active day in the schedule editor
  activeDay: Day
  setActiveDay: (day: Day) => void

  // Review mode — set after auto-scheduler completes
  isReviewMode: boolean
  setReviewMode: (v: boolean) => void

  // Sidebar collapse
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // Background AS job tracking
  activeAsJob: ActiveAsJob | null
  setActiveAsJob: (job: ActiveAsJob | null) => void
}

/** Sync data-theme attribute to match current dark mode state */
function applyTheme(isDark: boolean) {
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

/** Read initial dark mode from localStorage, fallback to system preference */
function getInitialDark(): boolean {
  const stored = localStorage.getItem('zmanim-dark')
  if (stored !== null) return stored === 'true'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function getInitialSidebarCollapsed(): boolean {
  return localStorage.getItem('zmanim-sidebar-collapsed') === 'true'
}

function getInitialActiveAsJob(): ActiveAsJob | null {
  try {
    const raw = localStorage.getItem('zmanim-active-as-job')
    return raw ? (JSON.parse(raw) as ActiveAsJob) : null
  } catch {
    return null
  }
}

const initialDark = getInitialDark()
applyTheme(initialDark)

export const useUIStore = create<UIState>(set => ({
  isDark: initialDark,
  toggleDark: () =>
    set(state => {
      const next = !state.isDark
      localStorage.setItem('zmanim-dark', String(next))
      applyTheme(next)
      return { isDark: next }
    }),

  activeDay: Day.SUNDAY,
  setActiveDay: day => set({ activeDay: day }),

  isReviewMode: false,
  setReviewMode: v => set({ isReviewMode: v }),

  sidebarCollapsed: getInitialSidebarCollapsed(),
  toggleSidebar: () =>
    set(state => {
      const next = !state.sidebarCollapsed
      localStorage.setItem('zmanim-sidebar-collapsed', String(next))
      return { sidebarCollapsed: next }
    }),

  activeAsJob: getInitialActiveAsJob(),
  setActiveAsJob: job => {
    if (job) {
      localStorage.setItem('zmanim-active-as-job', JSON.stringify(job))
    } else {
      localStorage.removeItem('zmanim-active-as-job')
    }
    set({ activeAsJob: job })
  },
}))
