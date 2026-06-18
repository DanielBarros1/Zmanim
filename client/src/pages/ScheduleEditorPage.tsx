/**
 * ScheduleEditorPage — the main schedule editing interface.
 *
 * Architecture:
 *   - DndContext wraps the grid + lesson pool
 *   - Dragging from pool → drop on EmptyCell → usePlaceEntry
 *   - Dragging from grid → drop on EmptyCell → useMoveEntry
 *   - Dragging from grid → drop on occupied cell → swap (move existing out to pool first)
 *   - Client evaluator runs on drag start to show preview violations
 *   - If violations found → ViolationConfirmModal shown before API call
 *   - Server confirms placement and updates evaluation cache via useEvaluation()
 *
 * Review Mode (set after auto-scheduler completes or manually toggled):
 *   - Grid is read-only; lesson pool is hidden
 *   - Violation panel auto-opens
 *   - Topbar shows "Publish Schedule" + "← Edit Mode" buttons
 *   - After publish: green success banner → redirect to home in 2 s
 *
 * Evaluation flow:
 *   - useEvaluation() fetches the authoritative EvaluationResult on mount
 *   - usePlaceEntry / useMoveEntry / useRemoveEntry all write their returned
 *     evaluation into the same React Query cache key, so the evaluation shown
 *     is always current without any local useState.
 *
 * Layout:
 *   <AppShell noScroll>
 *     [PublishSuccessBanner]
 *     <StatsBar />
 *     <DayTabs />
 *     <ViolationsBanner /> (conditional)
 *     <main row>
 *       <ScheduleGrid />
 *       <LessonPool />         (hidden in review mode)
 *       <ViolationPanel />     (conditional, slide-in)
 *     </main>
 *   </AppShell>
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
  type DragCancelEvent,
} from '@dnd-kit/core'
import { AppShell } from '../components/layout/AppShell'
import { StatsBar } from '../components/schedule/StatsBar'
import { DayTabs } from '../components/schedule/DayTabs'
import { ViolationsBanner } from '../components/schedule/ViolationsBanner'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { LessonPool } from '../components/schedule/LessonPool'
import { ViolationPanel } from '../components/schedule/ViolationPanel'
import { ViolationConfirmModal } from '../components/schedule/ViolationConfirmModal'
import { LessonPlacementModal } from '../components/schedule/LessonPlacementModal'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'
import {
  useSchedule,
  useEntries,
  useEvaluation,
  usePlaceEntry,
  useMoveEntry,
  useRemoveEntry,
  usePublishSchedule,
  useChangeEntryRoom,
} from '../api/schedules'
import { useRooms } from '../api/rooms'
import { useSubjects } from '../api/subjects'
import { useTeachers } from '../api/teachers'
import { useGrades, useClasses } from '../api/grades'
import { useLessons } from '../api/lessons'
import { useConfig } from '../api/config'
import { useUIStore } from '../store/uiStore'
import { useScheduleStore } from '../store/scheduleStore'
import { checkProposed } from '../lib/evaluator'
import type { ClientViolation } from '../lib/evaluator'
import type { ScheduleSummary } from '@zmanim/shared'
import type { Day, RestrictionType } from '@zmanim/shared'
import { Day as DayEnum, RestrictionTier, LessonType } from '@zmanim/shared'
import type { CellValidity } from '../components/schedule/EmptyCell'

const DAY_LABEL: Record<Day, string> = {
  [DayEnum.SUNDAY]: 'Sunday',
  [DayEnum.MONDAY]: 'Monday',
  [DayEnum.TUESDAY]: 'Tuesday',
  [DayEnum.WEDNESDAY]: 'Wednesday',
  [DayEnum.THURSDAY]: 'Thursday',
}

// ── Drag overlay pill ──────────────────────────────────────────

function DragPill({ label }: { label: string }) {
  return (
    <div
      className="px-3 py-1.5 rounded-md text-[12px] font-medium shadow-lg"
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      {label}
    </div>
  )
}

// ── Publish success banner ─────────────────────────────────────

function PublishBanner() {
  return (
    <div
      className="px-6 py-3 text-center text-[13px] font-semibold flex-shrink-0 flex items-center justify-center gap-2"
      style={{
        background: 'var(--ok-bg)',
        color: 'var(--ok-text)',
        borderBottom: '1px solid var(--ok-border)',
      }}
    >
      <span>✅</span>
      <span>Schedule published successfully — returning to home…</span>
    </div>
  )
}

// ── Undo/redo ─────────────────────────────────────────────────────

interface HistoryItem {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

// ── Page ────────────────────────────────────────────────────────

export function ScheduleEditorPage() {
  const { id: scheduleId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Data fetching
  const { data: schedule, isLoading: scheduleLoading } = useSchedule(scheduleId)
  const { data: entries = [], isLoading: entriesLoading } = useEntries(scheduleId)
  const { data: evaluation = null } = useEvaluation(scheduleId)
  const { data: lessons = [] } = useLessons()
  const { data: subjects = [] } = useSubjects()
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: config } = useConfig()

  // Mutations
  const placeEntry = usePlaceEntry(scheduleId)
  const moveEntry = useMoveEntry(scheduleId)
  const removeEntry = useRemoveEntry(scheduleId)
  const changeRoom = useChangeEntryRoom(scheduleId)
  const publishSchedule = usePublishSchedule()

  // Rooms (for LessonCard badge + override popover)
  const { data: rooms = [] } = useRooms()

  // ── Undo / redo ──────────────────────────────────────────────────
  const undoStack = useRef<HistoryItem[]>([])
  const redoStack = useRef<HistoryItem[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncUndoState = useCallback(() => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  const pushHistory = useCallback((item: HistoryItem) => {
    undoStack.current.push(item)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    syncUndoState()
  }, [syncUndoState])

  const handleUndo = useCallback(async () => {
    const item = undoStack.current.pop()
    if (!item) return
    redoStack.current.push(item)
    syncUndoState()
    try {
      await item.undo()
    } catch {
      redoStack.current.pop()
      undoStack.current.push(item)
      syncUndoState()
    }
  }, [syncUndoState])

  const handleRedo = useCallback(async () => {
    const item = redoStack.current.pop()
    if (!item) return
    undoStack.current.push(item)
    syncUndoState()
    try {
      await item.redo()
    } catch {
      undoStack.current.pop()
      redoStack.current.push(item)
      syncUndoState()
    }
  }, [syncUndoState])

  // UI state
  const { activeDay, setActiveDay, isReviewMode, setReviewMode } = useUIStore()
  const { highlightedEntryIds, clearHighlight } = useScheduleStore()
  const [showViolationPanel, setShowViolationPanel] = useState(false)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [weekView, setWeekView] = useState(true)          // week view is the default
  const [filterSubjectId, setFilterSubjectId] = useState('')

  // Track the live native pointer position so handleDragEnd always has an
  // accurate drop coordinate.  Using activatorEvent.clientX + delta.x is
  // theoretically equivalent but in practice breaks when there are nested
  // overflow scroll containers (e.g. the week-view layout): the coordinate
  // origins can be mis-attributed between the two scroll layers.  A raw
  // pointermove listener is always pixel-accurate.
  const dragPointerRef = useRef({ x: 0, y: 0 })

  // ── Drag-conflict nudge tooltip ──────────────────────────────────
  // Pre-computed during handleDragStart alongside cellValidity.
  // Key: `${day}:${slot}:${classId}`, value: tooltip text or null.
  // Null means "no tooltip for this cell" (valid / soft cells stay clean).
  // The tooltip DOM element is updated directly (no React state) so pointer
  // movement causes zero re-renders.
  const cellReasonsRef  = useRef<Map<string, string>>(new Map())
  const tooltipRef      = useRef<HTMLDivElement>(null)
  const lastCellKeyRef  = useRef<string>('')

  useEffect(() => {
    const track = (e: PointerEvent) => {
      dragPointerRef.current = { x: e.clientX, y: e.clientY }

      // ── Tooltip update (direct DOM, zero re-renders) ────────────────
      const tooltip = tooltipRef.current
      if (!tooltip) return

      // Only show tooltip when cell reasons are populated (i.e. during a drag)
      if (cellReasonsRef.current.size === 0) {
        tooltip.style.display = 'none'
        lastCellKeyRef.current = ''
        return
      }

      // Hit-test the element stack at the current pointer position
      const elements = document.elementsFromPoint(e.clientX, e.clientY)
      let cellEl: Element | null = null
      for (const el of elements) {
        const candidate = el.closest('[data-cell-day]')
        if (candidate) {
          const rect = candidate.getBoundingClientRect()
          if (
            e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom
          ) {
            cellEl = candidate
            break
          }
        }
      }

      if (!cellEl) {
        tooltip.style.display = 'none'
        lastCellKeyRef.current = ''
        return
      }

      const day     = cellEl.getAttribute('data-cell-day')
      const slot    = cellEl.getAttribute('data-cell-slot')
      const classId = cellEl.getAttribute('data-cell-class-id')
      if (!day || !slot || !classId) {
        tooltip.style.display = 'none'
        return
      }

      const cellKey = `${day}:${slot}:${classId}`

      // Only update content when the cell changes (text update is still direct DOM)
      if (cellKey !== lastCellKeyRef.current) {
        lastCellKeyRef.current = cellKey
        const reason = cellReasonsRef.current.get(cellKey)
        if (!reason) {
          tooltip.style.display = 'none'
          return
        }
        tooltip.textContent = reason
      }

      // Always update position on every move
      const reason = cellReasonsRef.current.get(cellKey)
      if (!reason) {
        tooltip.style.display = 'none'
        return
      }
      tooltip.style.display = 'block'
      tooltip.style.left    = `${e.clientX + 16}px`
      tooltip.style.top     = `${e.clientY - 36}px`
    }

    // Capture phase ensures we see the event before any scroll container can
    // consume or re-target it.
    window.addEventListener('pointermove', track, { capture: true, passive: true })
    return () => window.removeEventListener('pointermove', track, true)
  }, [])

  /** Hide the tooltip and clear cell reasons — called on drag end / cancel */
  const clearDragTooltip = () => {
    cellReasonsRef.current = new Map()
    lastCellKeyRef.current = ''
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }

  // Per-cell drop validity — computed when a pool lesson is picked up.
  // Key: `${day}:${slot}:${classId}`, value: 'valid' | 'blocked' | 'impossible'.
  // Null when no pool drag is in progress (or when moving an existing entry).
  const [cellValidity, setCellValidity] = useState<Map<string, CellValidity> | null>(null)

  // Drag state — only used for DragOverlay rendering.
  // Do NOT read this in handleDragEnd: React batching means the state set
  // during onDragStart may not be flushed yet when onDragEnd fires.
  // Use event.active.data.current instead — dnd-kit keeps that ref current.
  type ActiveDrag = {
    type: 'pool' | 'entry'
    lessonId: string
    entryId?: string
    label: string
  }
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)

  // Visible error shown when a placement API call fails
  const [placementError, setPlacementError] = useState<string | null>(null)

  // Lesson placement modal (opened by clicking empty cell)
  const [cellClickModal, setCellClickModal] = useState<{ day: Day; slot: number; classId: string } | null>(null)

  // Violation confirm modal
  const [pendingAction, setPendingAction] = useState<{
    violations: ClientViolation[]
    execute: (note?: string) => Promise<void>
  } | null>(null)

  // Keep active day from config work days
  const workDays = config?.workDays ?? []

  // Sync active day to first work day if current is not a work day
  useEffect(() => {
    if (workDays.length > 0 && !workDays.includes(activeDay)) {
      setActiveDay(workDays[0] as Day)
    }
  }, [workDays, activeDay, setActiveDay])

  // Clear undo/redo history when switching to a different schedule
  useEffect(() => {
    undoStack.current = []
    redoStack.current = []
    syncUndoState()
  }, [scheduleId, syncUndoState])

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo
  useEffect(() => {
    if (isReviewMode) return
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isReviewMode, handleUndo, handleRedo])

  // Auto-open violation panel when entering Review Mode (e.g. after AS run)
  useEffect(() => {
    if (isReviewMode) {
      setShowViolationPanel(true)
    }
  }, [isReviewMode])

  // Switch active day to the day of the first highlighted entry so the cell
  // is visible when the user clicks a violation's "Highlight" button.
  // Then scroll the LessonCard into view (uses data-entry-id stamped on the card).
  useEffect(() => {
    if (highlightedEntryIds.length === 0) return
    const firstId = highlightedEntryIds[0]
    const firstEntry = entries.find(e => highlightedEntryIds.includes(e.id))
    if (firstEntry && firstEntry.day !== activeDay) {
      setActiveDay(firstEntry.day as Day)
    }
    // Two rAFs: first lets React flush the day-switch state update and re-render
    // the ScheduleGrid; second lets the browser paint so getBoundingClientRect
    // is accurate before scrollIntoView.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-entry-id="${firstId}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedEntryIds])

  // ── DnD setup ──────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px before drag activates
    }),
  )

  // Re-measure every droppable on every animation frame while dragging.
  // Without this, dnd-kit uses stale getBoundingClientRect() values — the
  // ScheduleGrid has its own overflow-auto scroll container, so when the
  // user scrolls the table horizontally the stored rects go out of sync
  // with what's on screen, causing drops to land in the wrong column.
  const measuringConfig = {
    droppable: { strategy: MeasuringStrategy.Always },
  }

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      clearHighlight()
      setPlacementError(null)
      const d = event.active.data.current as
        | { type: string; lessonId: string; entryId?: string }
        | undefined
      if (!d) return

      const lesson = lessons.find(l => l.id === d.lessonId)
      const subject = subjects.find(s => s.id === lesson?.subjectId)

      setActiveDrag({
        type: d.type as 'pool' | 'entry',
        lessonId: d.lessonId,
        entryId: d.entryId,
        label: subject?.name ?? 'Lesson',
      })

      // ── Drop-zone highlighting ────────────────────────────────────────────
      // When the user picks up a lesson (from pool or from an existing entry),
      // evaluate every grid cell client-side and colour it:
      //   'valid'     → green   (no violations)
      //   'soft'      → amber   (D3/D4 simultaneity or soft restrictions only)
      //   'blocked'   → red     (D1/D2 hard conflict — teacher or class occupied)
      //   'impossible'→ dim     (wrong class column for this lesson)
      if (lesson && config) {
        // For entry moves, exclude the card's own current placement so its
        // source slot doesn't appear as a self-conflict.
        const excludeEntryId = d.type === 'entry' ? d.entryId : undefined

        const validity  = new Map<string, CellValidity>()
        const newReasons = new Map<string, string>()

        // First pass: compute per-(day,slot) validity using the client evaluator.
        // Also collect the first violation message for blocked/soft cells (tooltip reasons).
        const daySlotValidity = new Map<string, 'valid' | 'soft' | 'blocked'>()
        const daySlotReason   = new Map<string, string>()

        for (const day of workDays) {
          for (let slot = 1; slot <= config.slotsPerDay; slot++) {
            const violations = checkProposed({
              entries,
              lessons,
              proposed: { lessonId: lesson.id, day: day as Day, slot, excludeEntryId },
            })
            // All client-side violations (D1–D4) are INVARIANT tier → red blocked cell.
            // 'soft' (amber) would be for simultaneity warnings (not currently generated).
            const hardViol = violations.find(v => v.tier === RestrictionTier.INVARIANT)
            const softViol = violations.find(v => v.tier !== RestrictionTier.INVARIANT)

            if (hardViol) {
              daySlotValidity.set(`${day}:${slot}`, 'blocked')
              daySlotReason.set(`${day}:${slot}`, `⛔ ${hardViol.message}`)
            } else if (softViol) {
              daySlotValidity.set(`${day}:${slot}`, 'soft')
              daySlotReason.set(`${day}:${slot}`, `⚠ ${softViol.message}`)
            } else {
              daySlotValidity.set(`${day}:${slot}`, 'valid')
            }
          }
        }

        // Second pass: expand to per-cell.
        // A cell is 'impossible' if the lesson's classIds don't include that
        // class column (e.g. a Grade-7 lesson can't go in a Grade-9 column).
        for (const cls of classes) {
          for (const day of workDays) {
            for (let slot = 1; slot <= config.slotsPerDay; slot++) {
              const key = `${day}:${slot}:${cls.id}`
              if (!lesson.classIds.includes(cls.id)) {
                validity.set(key, 'impossible')
                // No tooltip for impossible cells — the dimmed style is self-explanatory
              } else {
                const v = daySlotValidity.get(`${day}:${slot}`) ?? 'blocked'
                validity.set(key, v)
                const reason = daySlotReason.get(`${day}:${slot}`)
                if (reason) newReasons.set(key, reason)
              }
            }
          }
        }

        setCellValidity(validity)
        cellReasonsRef.current = newReasons
      }
    },
    [lessons, subjects, entries, workDays, config, classes, clearHighlight],
  )

  // Cancel: Escape key or pointer leaves the window — just clear overlay
  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDrag(null)
    setCellValidity(null)
    clearDragTooltip()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // Always clear the overlay, validity map, and tooltip immediately so UI is responsive
      setActiveDrag(null)
      setCellValidity(null)
      clearDragTooltip()

      const { active } = event

      // Read drag data from the event (dnd-kit keeps active.data.current current via ref)
      const dragData = active.data.current as
        | { type: string; lessonId: string; entryId?: string }
        | undefined
      if (!dragData) return

      // ── Drop target detection via DOM hit-testing ──────────────────────
      //
      // We do NOT use dnd-kit's `over.data.current` here. In nested overflow-auto
      // containers, dnd-kit's rect-based collision detection can have systematic
      // offsets caused by stale getBoundingClientRect() snapshots or
      // mis-attributed scroll origins in the layout.
      //
      // Instead we use the native pointer position captured via the global
      // pointermove listener (dragPointerRef).  This is always viewport-accurate
      // regardless of scroll container nesting — fixing drops in the week view
      // where each ScheduleGrid has its own overflow-auto inside an outer
      // overflow-y-auto container.
      //
      // document.elementsFromPoint() is the browser's own pixel-accurate hit-test.
      // EmptyCell / group-occupied <td> cells stamp data-cell-day / data-cell-slot /
      // data-cell-class-id so we can read the target without any coordinate math.
      // The DragOverlay pill has pointer-events:none but elementsFromPoint still
      // returns it; it has no data-cell-day so we skip it naturally.
      const { x: finalX, y: finalY } = dragPointerRef.current

      const elements = document.elementsFromPoint(finalX, finalY)

      // Walk up from each hit element until we find one that is (or is inside)
      // an EmptyCell div (or sibling-group <td>) stamped with data-cell-day.
      //
      // Important: when moving an existing entry the LessonCard is physically
      // in the SOURCE cell but visually translated to the drop position via CSS
      // transform.  elementsFromPoint() returns it at its visual (drop) position,
      // but .closest('[data-cell-day]') then walks the real DOM tree upward and
      // finds the SOURCE cell's data-cell-day attributes — making every move look
      // like a drop back onto the source slot.
      //
      // Guard: after .closest() finds a candidate, verify its bounding rect
      // actually contains the pointer.  The source cell's rect is at the original
      // slot position (not the drop position), so it fails the check and we keep
      // looking.  The real target element's rect DOES contain the pointer. ✓
      let cellEl: Element | null = null
      for (const el of elements) {
        const candidate = el.closest('[data-cell-day]')
        if (candidate) {
          const rect = candidate.getBoundingClientRect()
          if (
            finalX >= rect.left && finalX <= rect.right &&
            finalY >= rect.top  && finalY <= rect.bottom
          ) {
            cellEl = candidate
            break
          }
        }
      }
      if (!cellEl) return   // dropped outside any valid cell

      const day = cellEl.getAttribute('data-cell-day') as Day
      const slot = Number(cellEl.getAttribute('data-cell-slot'))
      const { type, lessonId, entryId } = dragData

      // Look up the lesson being dragged so we can detect group types below
      const lesson = lessons.find(l => l.id === lessonId)
      const isGroupLesson =
        lesson?.type === LessonType.MATH_GROUP || lesson?.type === LessonType.ENGLISH_GROUP
      const subjectName = subjects.find(s => s.id === lesson?.subjectId)?.name ?? 'Lesson'

      // Client-side constraint preview (hard invariants only — server is authoritative)
      const allViolations = checkProposed({
        entries,
        lessons,
        proposed: { lessonId, day, slot, excludeEntryId: entryId },
      })

      // For group lessons dragged from the pool, D3/D4 (simultaneity) violations are
      // spurious: the auto-placement logic will place all siblings at the same slot
      // immediately after, so the "incomplete group" warning never actually materialises.
      // D1/D2 (teacher/class double-booked) are still shown — those are real blockers.
      const violations = (isGroupLesson && type === 'pool')
        ? allViolations.filter(
            v => v.type !== 'MATH_GROUPS_NOT_SIMULTANEOUS' && v.type !== 'ENGLISH_GROUPS_NOT_SIMULTANEOUS',
          )
        : allViolations

      const execute = async (note?: string) => {
        try {
          if (type === 'pool') {
            const overrides = violations.map(v => ({
              restrictionType: v.type as unknown as RestrictionType,
              note,
            }))

            // Place the dragged lesson first
            const result = await placeEntry.mutateAsync({ lessonId, day, slot, overrides })

            // Mutable array — entryIds are updated by redo so undo always removes the right entries
            const placed: Array<{ id: string; lessonId: string; day: Day; slot: number }> = [
              { id: result.entry.id, lessonId, day, slot },
            ]

            // ── Group auto-placement ───────────────────────────────────────
            // MATH_GROUP and ENGLISH_GROUP lessons for the same grade must all
            // occupy the same (day, slot) (D3/D4 invariant).  When the user
            // drags one level from the pool we automatically place all sibling
            // levels at the same slot so they start in sync.
            if (isGroupLesson && lesson?.gradeId) {
              const siblings = lessons.filter(
                l =>
                  l.id !== lesson.id &&
                  l.type === lesson.type &&
                  l.gradeId === lesson.gradeId,
              )

              // Snapshot which lessons are already at this (day, slot) so we
              // don't double-place a sibling that was previously placed here.
              const alreadyAtSlot = new Set(
                entries
                  .filter(e => e.day === day && e.slot === slot)
                  .map(e => e.lessonId),
              )

              for (const sibling of siblings) {
                const siblingPlaced = entries.filter(e => e.lessonId === sibling.id).length
                const siblingRemaining = sibling.hoursPerWeek - siblingPlaced
                if (siblingRemaining <= 0) continue      // already fully placed
                if (alreadyAtSlot.has(sibling.id)) continue  // already here
                // No violation modal for siblings — they're synchronised by design
                const sibResult = await placeEntry.mutateAsync({ lessonId: sibling.id, day, slot, overrides: [] })
                placed.push({ id: sibResult.entry.id, lessonId: sibling.id, day, slot })
              }
            }

            // Single undo item undoes the whole batch (main + siblings)
            pushHistory({
              label: `Place ${subjectName}`,
              undo: async () => {
                for (const p of placed) await removeEntry.mutateAsync(p.id)
              },
              redo: async () => {
                for (const p of placed) {
                  const r = await placeEntry.mutateAsync({ lessonId: p.lessonId, day: p.day, slot: p.slot, overrides: [] })
                  p.id = r.entry.id  // update ref so next undo removes the new entry
                }
              },
            })

          } else if (type === 'entry' && entryId) {
            // Capture original position before the move
            const originalEntry = entries.find(e => e.id === entryId)
            const fromDay = (originalEntry?.day ?? day) as Day
            const fromSlot = originalEntry?.slot ?? slot

            await moveEntry.mutateAsync({
              entryId,
              data: {
                day,
                slot,
                overrides: violations.map(v => ({
                  restrictionType: v.type as unknown as RestrictionType,
                  note,
                })),
              },
            })

            pushHistory({
              label: `Move ${subjectName}`,
              undo: async () => {
                await moveEntry.mutateAsync({ entryId, data: { day: fromDay, slot: fromSlot, overrides: [] } })
              },
              redo: async () => {
                await moveEntry.mutateAsync({ entryId, data: { day, slot, overrides: [] } })
              },
            })
          }
        } catch (err: any) {
          const msg =
            err?.response?.data?.error ??
            err?.message ??
            'Placement failed — check your connection.'
          setPlacementError(msg)
          console.error('Placement failed:', err)
        }
      }

      if (violations.length > 0) {
        setPendingAction({ violations, execute })
      } else {
        await execute()
      }
    },
    [entries, lessons, subjects, placeEntry, moveEntry, removeEntry, pushHistory],
  )

  // ── Actions ───────────────────────────────────────────────────

  const handleRemoveEntry = useCallback(
    async (entryId: string) => {
      const entry = entries.find(e => e.id === entryId)
      if (!entry) return
      const lesson = lessons.find(l => l.id === entry.lessonId)
      const subjectName = subjects.find(s => s.id === lesson?.subjectId)?.name ?? 'Lesson'
      const { lessonId, day, slot } = entry

      await removeEntry.mutateAsync(entryId)

      // Mutable ref — undo re-places (new ID), redo removes the re-placed entry
      const placed = { id: '' }
      pushHistory({
        label: `Remove ${subjectName}`,
        undo: async () => {
          const r = await placeEntry.mutateAsync({ lessonId, day: day as Day, slot, overrides: [] })
          placed.id = r.entry.id
        },
        redo: async () => {
          await removeEntry.mutateAsync(placed.id)
        },
      })
    },
    [entries, lessons, subjects, removeEntry, placeEntry, pushHistory],
  )

  const handleCellClick = useCallback(
    (day: Day, slot: number, classId: string) => {
      setCellClickModal({ day, slot, classId })
    },
    [],
  )

  const handlePlaceLessonFromModal = useCallback(
    (lessonId: string) => {
      if (!cellClickModal) return
      const { day, slot } = cellClickModal
      placeEntry.mutate({ lessonId, day, slot })
      setCellClickModal(null)
    },
    [cellClickModal, placeEntry],
  )

  // which=1 → update roomId (default); which=2 → update roomId2 (PARALLEL second class)
  const handleChangeRoom = useCallback(
    (entryId: string, roomId: string | null, which: 1 | 2 = 1) => {
      if (which === 2) changeRoom.mutate({ entryId, roomId2: roomId })
      else             changeRoom.mutate({ entryId, roomId })
    },
    [changeRoom],
  )

  const handlePublish = useCallback(async () => {
    try {
      await publishSchedule.mutateAsync(scheduleId)
      setPublishSuccess(true)
      // Give the user a moment to read the success banner, then go home
      setTimeout(() => {
        setReviewMode(false)
        navigate('/')
      }, 2000)
    } catch (err) {
      console.error('Publish failed:', err)
    }
  }, [publishSchedule, scheduleId, setReviewMode, navigate])

  // ── Loading / error ───────────────────────────────────────────

  if (scheduleLoading || entriesLoading || !config) {
    return (
      <AppShell title="Loading…">
        <CenteredSpinner />
      </AppShell>
    )
  }

  if (!schedule) {
    return (
      <AppShell title="Schedule not found">
        <div className="flex flex-col items-center gap-4 py-20">
          <p className="text-[var(--text-2)]">This schedule doesn't exist or was deleted.</p>
          <Button onClick={() => navigate('/')}>← Back to Schedules</Button>
        </div>
      </AppShell>
    )
  }

  // Build a ScheduleSummary-compatible object for StatsBar
  const totalRequired = lessons.reduce((sum, l) => sum + l.hoursPerWeek, 0)
  const totalPlaced = entries.length
  const scheduleSummary: ScheduleSummary = {
    ...schedule,
    totalRequired,
    totalPlaced,
  }

  // ── Topbar actions — different in Review Mode vs Edit Mode ────

  const topbarActions = isReviewMode ? (
    <div className="flex items-center gap-2">
      {/* Review Mode badge */}
      <span
        className="text-[11px] font-semibold px-2 py-1 rounded"
        style={{ background: 'var(--warn-badge)', color: 'var(--warn-text)' }}
      >
        Review Mode
      </span>

      {/* Violation count shortcut */}
      {evaluation && evaluation.counts.total > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowViolationPanel(p => !p)}
        >
          {showViolationPanel ? 'Hide Violations' : 'Violations'}{' '}
          ({evaluation.counts.total})
        </Button>
      )}

      {/* Exit back to edit mode without publishing */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setReviewMode(false)
          setShowViolationPanel(false)
        }}
      >
        ← Edit Mode
      </Button>

      {/* Publish — the primary CTA in Review Mode */}
      <Button
        size="sm"
        onClick={handlePublish}
        loading={publishSchedule.isPending}
        disabled={publishSuccess}
      >
        ✓ Publish Schedule
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {/* Undo / Redo */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↩ Undo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        ↪ Redo
      </Button>

      {/* Subject filter — dims non-matching cells */}
      <select
        value={filterSubjectId}
        onChange={e => setFilterSubjectId(e.target.value)}
        className="h-7 rounded-md px-2 text-[12px]"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: filterSubjectId ? 'var(--accent)' : 'var(--text-3)',
        }}
        title="Filter grid by subject"
      >
        <option value="">All subjects</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setWeekView(v => !v)}
        title={weekView ? 'Switch to day view' : 'Switch to week view'}
      >
        {weekView ? '📅 Day' : '🗓 Week'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowViolationPanel(p => !p)}
      >
        {showViolationPanel ? 'Hide Violations' : 'Violations'}{' '}
        {evaluation && evaluation.counts.total > 0
          ? `(${evaluation.counts.total})`
          : ''}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
        ← Schedules
      </Button>
    </div>
  )

  return (
    <DndContext
      sensors={sensors}
      measuring={measuringConfig}
      collisionDetection={pointerWithin}
      // Disable dnd-kit's built-in auto-scroll.
      // In week view the auto-scroll scrolls the overflow-y-auto wrapper when the
      // pointer moves downward toward the next day, making the whole view shift —
      // the user perceives this as "the Sunday card is scrolling."
      // Disabling is safe here: the schedule is compact enough that all slots are
      // usually visible without needing to scroll while dragging.
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <AppShell title={schedule.name} actions={topbarActions} noScroll>
        {/* Publish success banner (shown briefly before redirect) */}
        {publishSuccess && <PublishBanner />}

        {/* Placement error banner — shown when a drag-drop API call fails */}
        {placementError && (
          <div
            className="px-4 py-2 flex items-center gap-2 text-[12px] font-medium flex-shrink-0"
            style={{
              background: '#FEE2E2',
              color: '#B91C1C',
              borderBottom: '1px solid #FECACA',
            }}
          >
            <span>⛔</span>
            <span className="flex-1">{placementError}</span>
            <button
              className="text-[11px] underline"
              onClick={() => setPlacementError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stats bar */}
        <StatsBar schedule={scheduleSummary} evaluation={evaluation} />

        {/* Day tabs — hidden in week view */}
        {!weekView && <DayTabs entries={entries} workDays={workDays as Day[]} />}

        {/* Violations banner */}
        {evaluation && evaluation.counts.total > 0 && (
          <ViolationsBanner
            evaluation={evaluation}
            onViewAll={() => setShowViolationPanel(true)}
          />
        )}

        {/* Main content row */}
        <div className="flex flex-1 overflow-hidden">
          {weekView ? (
            /* ── Week view: all work days stacked vertically ──
               This wrapper owns ALL scrolling for the week view.
               overflow-y scrolls across days; overflow-x handles wide tables.
               Each ScheduleGrid has noVerticalOverflow which strips its own
               overflow so the table naturally overflows into this container —
               no nested scroll containers, no drag-induced scroll. */
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              {workDays.map(day => (
                <div key={day} className="mb-6">
                  {/* Day header */}
                  <div
                    className="sticky top-0 z-10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                    style={{
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {DAY_LABEL[day as Day]}
                  </div>
                  <ScheduleGrid
                    day={day as Day}
                    entries={entries}
                    lessons={lessons}
                    subjects={subjects}
                    teachers={teachers}
                    grades={grades}
                    classes={classes}
                    config={config}
                    evaluation={evaluation}
                    rooms={rooms}
                    isReviewMode={isReviewMode}
                    noVerticalOverflow
                    cellValidity={cellValidity}
                    filterSubjectId={filterSubjectId}
                    onRemoveEntry={handleRemoveEntry}
                    onChangeRoom={handleChangeRoom}
                    onCellClick={handleCellClick}
                  />
                </div>
              ))}
            </div>
          ) : (
            /* ── Day view: single day grid ── */
            <ScheduleGrid
              day={activeDay}
              entries={entries}
              lessons={lessons}
              subjects={subjects}
              teachers={teachers}
              grades={grades}
              classes={classes}
              config={config}
              evaluation={evaluation}
              rooms={rooms}
              isReviewMode={isReviewMode}
              cellValidity={cellValidity}
              onRemoveEntry={handleRemoveEntry}
              onChangeRoom={handleChangeRoom}
              onCellClick={handleCellClick}
            />
          )}

          {/* Lesson pool (hidden in review mode) */}
          {!isReviewMode && (
            <LessonPool
              lessons={lessons}
              entries={entries}
              subjects={subjects}
              teachers={teachers}
              grades={grades}
              classes={classes}
              filterSubjectId={filterSubjectId}
            />
          )}

          {/* Violation panel (slide-in; always visible in review mode while open) */}
          {showViolationPanel && evaluation && (
            <ViolationPanel
              evaluation={evaluation}
              scheduleId={scheduleId}
              onClose={() => setShowViolationPanel(false)}
            />
          )}
        </div>
      </AppShell>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDrag && <DragPill label={activeDrag.label} />}
      </DragOverlay>

      {/* Drag-conflict nudge tooltip — positioned via direct DOM, never via React state */}
      <div
        ref={tooltipRef}
        style={{
          display:         'none',
          position:        'fixed',
          zIndex:          9999,
          pointerEvents:   'none',
          maxWidth:        240,
          padding:         '5px 10px',
          borderRadius:    6,
          fontSize:        11,
          lineHeight:      1.45,
          fontWeight:      500,
          background:      'rgba(15, 23, 42, 0.92)',
          color:           '#f1f5f9',
          boxShadow:       '0 4px 12px rgba(0,0,0,0.3)',
          backdropFilter:  'blur(4px)',
          whiteSpace:      'pre-line',
          wordBreak:       'break-word',
        }}
      />

      {/* Violation confirm modal */}
      <ViolationConfirmModal
        open={!!pendingAction}
        violations={pendingAction?.violations ?? []}
        onConfirm={async note => {
          if (pendingAction) {
            await pendingAction.execute(note)
            setPendingAction(null)
          }
        }}
        onCancel={() => setPendingAction(null)}
        isLoading={placeEntry.isPending || moveEntry.isPending}
      />

      {/* Lesson placement modal (T6) — open when clicking an empty cell */}
      {cellClickModal && (
        <LessonPlacementModal
          open={!!cellClickModal}
          onClose={() => setCellClickModal(null)}
          slot={cellClickModal.slot}
          classId={cellClickModal.classId}
          lessons={lessons}
          subjects={subjects}
          entries={entries}
          onPlace={handlePlaceLessonFromModal}
          loading={placeEntry.isPending}
        />
      )}
    </DndContext>
  )
}
