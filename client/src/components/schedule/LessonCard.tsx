/**
 * LessonCard — a placed lesson in the schedule grid.
 *
 * Visual design (from design-spec.md §6):
 *   - White background (var(--card-bg) in dark mode)
 *   - 3px left border in the subject's color
 *   - Rounded corners (5px)
 *   - Subtle box shadow
 *   - Subject name (Hebrew, RTL, bold, 12.5px)
 *   - Teacher name (Hebrew, RTL, muted, 11px)
 *   - Optional tags: lesson type, math level, violations
 *   - Warning state: amber left border + warn-bg background
 *
 * Interaction:
 *   - useDraggable from @dnd-kit/core for drag-to-move
 *   - Right-click or × button to remove
 *   - Highlighted state when violation panel targets this entry
 */

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { ScheduleEntry, Lesson, Subject, Teacher } from '@zmanim/shared'
import { LessonType, MATH_LEVEL_LABEL } from '@zmanim/shared'
import type { Violation } from '@zmanim/shared'
import { useScheduleStore } from '../../store/scheduleStore'

interface LessonCardProps {
  entry: ScheduleEntry
  lesson: Lesson
  subject: Subject | undefined
  teacher: Teacher | undefined
  violations: Violation[]
  onRemove: () => void
  isReviewMode?: boolean
}

export function LessonCard({
  entry,
  lesson,
  subject,
  teacher,
  violations,
  onRemove,
  isReviewMode,
}: LessonCardProps) {
  const { highlightedEntryIds } = useScheduleStore()
  const isHighlighted = highlightedEntryIds.includes(entry.id)
  const hasViolation = violations.length > 0
  const hasHardViolation = violations.some(v => v.tier === 'NON_NEGOTIABLE')

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `entry-${entry.id}`,
    data: { type: 'entry', entryId: entry.id, lessonId: lesson.id },
    disabled: isReviewMode || entry.isSeeded,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 100 : undefined,
  }

  const borderColor = hasHardViolation
    ? '#EF4444'   // red for hard violations
    : hasViolation
    ? '#F59E0B'   // amber for soft violations
    : subject?.color ?? '#94A3B8'

  const bgColor = hasHardViolation
    ? 'var(--warn-bg)'
    : isHighlighted
    ? 'var(--accent-bg)'
    : 'var(--card-bg)'

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeft: `3px solid ${borderColor}`, background: bgColor }}
      className="relative rounded-[5px] p-1.5 select-none w-full"
      {...(!isReviewMode && !entry.isSeeded ? { ...listeners, ...attributes } : {})}
    >
      {/* Content */}
      <div className="min-w-0">
        <p
          className="text-[12.5px] font-bold truncate hebrew leading-tight"
          style={{ color: 'var(--text-1)' }}
          title={subject?.name}
        >
          {subject?.name ?? '—'}
        </p>
        <p
          className="text-[11px] truncate hebrew"
          style={{ color: 'var(--text-2)' }}
          title={teacher?.name}
        >
          {teacher?.name ?? '—'}
        </p>
      </div>

      {/* Tags row */}
      <div className="flex gap-1 mt-1 flex-wrap">
        {lesson.type === LessonType.SHARED && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
          >
            Shared
          </span>
        )}
        {lesson.type === LessonType.MATH_GROUP && lesson.mathLevel && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--warn-badge)', color: 'var(--warn-text)' }}
          >
            {MATH_LEVEL_LABEL[lesson.mathLevel]}
          </span>
        )}
        {entry.isSeeded && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            Seeded
          </span>
        )}
        {hasViolation && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{
              background: hasHardViolation ? '#FEE2E2' : 'var(--warn-badge)',
              color: hasHardViolation ? '#B91C1C' : 'var(--warn-text)',
            }}
          >
            {hasHardViolation ? '⛔' : '⚠'} {violations.length}
          </span>
        )}
      </div>

      {/* Remove button (hidden in review mode and for seeded lessons) */}
      {!isReviewMode && !entry.isSeeded && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded opacity-0 hover:opacity-100 group-hover:opacity-100 transition-opacity text-[10px]"
          style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
          title="Remove placement"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </div>
  )
}
