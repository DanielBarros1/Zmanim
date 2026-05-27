/**
 * Schedule Store — state that lives for the duration of an open schedule.
 *
 * activeScheduleId: the schedule currently open in the editor.
 * selectedEntryId:  which placed lesson is "focused" (shows detail panel).
 * draggingLessonId: lesson being dragged from the pool (null = nothing dragging).
 * draggingEntryId:  placed entry being moved (null = nothing moving).
 * highlightedEntryIds: entries highlighted by a violation click in the panel.
 */

import { create } from 'zustand'

interface ScheduleState {
  activeScheduleId: string | null
  setActiveScheduleId: (id: string | null) => void

  selectedEntryId: string | null
  setSelectedEntryId: (id: string | null) => void

  draggingLessonId: string | null
  setDraggingLessonId: (id: string | null) => void

  draggingEntryId: string | null
  setDraggingEntryId: (id: string | null) => void

  /** Entry IDs highlighted due to violation panel click */
  highlightedEntryIds: string[]
  setHighlightedEntryIds: (ids: string[]) => void
  clearHighlight: () => void
}

export const useScheduleStore = create<ScheduleState>(set => ({
  activeScheduleId: null,
  setActiveScheduleId: id => set({ activeScheduleId: id }),

  selectedEntryId: null,
  setSelectedEntryId: id => set({ selectedEntryId: id }),

  draggingLessonId: null,
  setDraggingLessonId: id => set({ draggingLessonId: id }),

  draggingEntryId: null,
  setDraggingEntryId: id => set({ draggingEntryId: id }),

  highlightedEntryIds: [],
  setHighlightedEntryIds: ids => set({ highlightedEntryIds: ids }),
  clearHighlight: () => set({ highlightedEntryIds: [] }),
}))
