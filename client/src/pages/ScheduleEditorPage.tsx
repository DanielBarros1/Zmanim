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
 *   - Server confirms placement and returns authoritative EvaluationResult
 *
 * Layout:
 *   <AppShell noScroll>
 *     <StatsBar />
 *     <DayTabs />
 *     <ViolationsBanner /> (conditional)
 *     <main row>
 *       <ScheduleGrid />
 *       <LessonPool />
 *       <ViolationPanel /> (conditional, slide-in)
 *     </main>
 *   </AppShell>
 */

import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { AppShell } from '../components/layout/AppShell'
import { StatsBar } from '../components/schedule/StatsBar'
import { DayTabs } from '../components/schedule/DayTabs'
import { ViolationsBanner } from '../components/schedule/ViolationsBanner'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { LessonPool } from '../components/schedule/LessonPool'
import { ViolationPanel } from '../components/schedule/ViolationPanel'
import { ViolationConfirmModal } from '../components/schedule/ViolationConfirmModal'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useSchedule, useEntries, usePlaceEntry, useMoveEntry, useRemoveEntry } from '../api/schedules'
import { useSubjects } from '../api/subjects'
import { useTeachers } from '../api/teachers'
import { useGrades, useClasses } from '../api/grades'
import { useLessons } from '../api/lessons'
import { useConfig } from '../api/config'
import { useUIStore } from '../store/uiStore'
import { useScheduleStore } from '../store/scheduleStore'
import { checkProposed } from '../lib/evaluator'
import type { ClientViolation } from '../lib/evaluator'
import type { EvaluationResult, ScheduleSummary } from '@zmanim/shared'
import type { Day, RestrictionType } from '@zmanim/shared'

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

// ── Page ────────────────────────────────────────────────────────

export function ScheduleEditorPage() {
  const { id: scheduleId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Data fetching
  const { data: schedule, isLoading: scheduleLoading } = useSchedule(scheduleId)
  const { data: entries = [], isLoading: entriesLoading } = useEntries(scheduleId)
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

  // UI state
  const { activeDay, setActiveDay, isReviewMode } = useUIStore()
  const { clearHighlight } = useScheduleStore()
  const [showViolationPanel, setShowViolationPanel] = useState(false)
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)

  // Drag state
  const [activeDrag, setActiveDrag] = useState<{
    type: 'pool' | 'entry'
    lessonId: string
    entryId?: string
    label: string
  } | null>(null)

  // Violation confirm modal
  const [pendingAction, setPendingAction] = useState<{
    violations: ClientViolation[]
    execute: (note?: string) => Promise<void>
  } | null>(null)

  // Update evaluation from last server response
  const handlePlacementResult = useCallback((result: { evaluation: EvaluationResult }) => {
    setEvaluation(result.evaluation)
  }, [])

  // Keep active day from config work days
  const workDays = config?.workDays ?? []

  // Sync active day to first work day if current is not a work day
  useEffect(() => {
    if (workDays.length > 0 && !workDays.includes(activeDay)) {
      setActiveDay(workDays[0] as Day)
    }
  }, [workDays, activeDay, setActiveDay])

  // ── DnD setup ──────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px before drag activates
    }),
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      clearHighlight()
      const { data } = event.active
      const d = data.current as { type: string; lessonId: string; entryId?: string }
      if (!d) return

      const lesson = lessons.find(l => l.id === d.lessonId)
      const subject = subjects.find(s => s.id === lesson?.subjectId)
      const label = subject?.name ?? 'Lesson'

      setActiveDrag({
        type: d.type as 'pool' | 'entry',
        lessonId: d.lessonId,
        entryId: d.entryId,
        label,
      })
    },
    [lessons, subjects, clearHighlight],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDrag(null)
      const { over } = event
      if (!over) return

      const overData = over.data.current as {
        day: Day
        slot: number
        classId: string
      } | undefined

      if (!overData) return

      const { day, slot } = overData
      const drag = activeDrag
      if (!drag) return

      // Check client-side violations
      const violations = checkProposed({
        entries,
        lessons,
        proposed: {
          lessonId: drag.lessonId,
          day,
          slot,
          excludeEntryId: drag.entryId,
        },
      })

      const execute = async (note?: string) => {
        try {
          if (drag.type === 'pool') {
            // New placement from pool
            const result = await placeEntry.mutateAsync({
              lessonId: drag.lessonId,
              day,
              slot,
              // roomId omitted — server auto-assigns
              overrides: violations.map(v => ({
                restrictionType: v.type as unknown as RestrictionType,
                note,
              })),
            })
            handlePlacementResult(result)
          } else if (drag.type === 'entry' && drag.entryId) {
            // Move existing entry
            const result = await moveEntry.mutateAsync({
              entryId: drag.entryId,
              data: {
                day,
                slot,
                overrides: violations.map(v => ({
                  restrictionType: v.type as unknown as RestrictionType,
                  note,
                })),
              },
            })
            handlePlacementResult(result)
          }
        } catch (err) {
          console.error('Placement failed:', err)
        }
      }

      if (violations.length > 0) {
        // Show override confirmation before executing
        setPendingAction({ violations, execute })
      } else {
        await execute()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDrag, entries, lessons, placeEntry, moveEntry, handlePlacementResult],
  )

  // ── Actions ───────────────────────────────────────────────────

  const handleRemoveEntry = useCallback(
    async (entryId: string) => {
      await removeEntry.mutateAsync(entryId)
    },
    [removeEntry],
  )

  const handleCellClick = useCallback(
    (_day: Day, _slot: number, _classId: string) => {
      // For now: cell click does nothing without drag (lessons must be dragged from pool)
      // Future: could open a picker modal
    },
    [],
  )

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

  const topbarActions = (
    <div className="flex items-center gap-2">
      {isReviewMode && (
        <span
          className="text-[11px] font-semibold px-2 py-1 rounded"
          style={{ background: 'var(--warn-badge)', color: 'var(--warn-text)' }}
        >
          Review Mode
        </span>
      )}
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
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <AppShell title={schedule.name} actions={topbarActions} noScroll>
        {/* Stats bar */}
        <StatsBar schedule={scheduleSummary} evaluation={evaluation} />

        {/* Day tabs */}
        <DayTabs entries={entries} workDays={workDays as Day[]} />

        {/* Violations banner */}
        {evaluation && evaluation.counts.total > 0 && (
          <ViolationsBanner
            evaluation={evaluation}
            onViewAll={() => setShowViolationPanel(true)}
          />
        )}

        {/* Main content row */}
        <div className="flex flex-1 overflow-hidden">
          {/* Schedule grid */}
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
            isReviewMode={isReviewMode}
            onRemoveEntry={handleRemoveEntry}
            onCellClick={handleCellClick}
          />

          {/* Lesson pool (hidden in review mode) */}
          {!isReviewMode && (
            <LessonPool
              lessons={lessons}
              entries={entries}
              subjects={subjects}
              teachers={teachers}
              grades={grades}
              classes={classes}
            />
          )}

          {/* Violation panel (slide-in) */}
          {showViolationPanel && evaluation && (
            <ViolationPanel
              evaluation={evaluation}
              onClose={() => setShowViolationPanel(false)}
            />
          )}
        </div>
      </AppShell>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDrag && <DragPill label={activeDrag.label} />}
      </DragOverlay>

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
    </DndContext>
  )
}
