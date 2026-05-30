/**
 * LessonPool — the right-side panel showing unplaced lessons.
 *
 * Features:
 *  - Grade filter chips (All | 7–12) to focus on one grade at a time
 *  - Type filter toggle (All | Groups | Regular) to surface group lessons
 *  - Draggable pool items — drag to a grid cell to place
 *  - Group lessons (MATH_GROUP / ENGLISH_GROUP) show a chain badge indicating
 *    they will auto-place all sibling levels when dropped
 */

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type {
  Lesson,
  ScheduleEntry,
  Subject,
  Teacher,
  Grade,
  Class,
} from '@zmanim/shared'
import { LessonType, MATH_LEVEL_LABEL } from '@zmanim/shared'

// ─── Pool item ─────────────────────────────────────────────────

interface PoolItemProps {
  lesson: Lesson
  remaining: number
  subject: Subject | undefined
  teacher: Teacher | undefined
  classLabels: string[]
  siblingCount: number   // how many sibling group lessons will auto-place with this one
}

function PoolItem({ lesson, remaining, subject, teacher, classLabels, siblingCount }: PoolItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${lesson.id}`,
    data: { type: 'pool', lessonId: lesson.id },
  })

  const isGroup = lesson.type === LessonType.MATH_GROUP || lesson.type === LessonType.ENGLISH_GROUP

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--card-bg)',
        border: `1px solid var(--border)`,
        borderLeftWidth: 3,
        borderLeftColor: subject?.color ?? '#94A3B8',
        touchAction: 'none',
      }}
      {...listeners}
      {...attributes}
      className="rounded-md px-2 py-2 select-none hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p
            className="text-[12px] font-semibold truncate hebrew"
            style={{ color: 'var(--text-1)' }}
          >
            {subject?.name ?? '—'}
          </p>
          <p
            className="text-[10px] truncate hebrew"
            style={{ color: 'var(--text-3)' }}
          >
            {teacher?.name ?? '—'}
          </p>
        </div>
        <span
          className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{
            background: 'var(--warn-badge)',
            color: 'var(--warn-text)',
          }}
        >
          ×{remaining}
        </span>
      </div>

      <div className="flex gap-1 mt-1 flex-wrap">
        {classLabels.map(label => (
          <span
            key={label}
            className="text-[9px] px-1 py-0.5 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            {label}
          </span>
        ))}

        {lesson.type === LessonType.SHARED && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
          >
            Shared
          </span>
        )}

        {lesson.type === LessonType.MATH_GROUP && lesson.mathLevel && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            style={{ background: 'var(--warn-badge)', color: 'var(--warn-text)' }}
          >
            {MATH_LEVEL_LABEL[lesson.mathLevel]}
          </span>
        )}

        {lesson.type === LessonType.ENGLISH_GROUP && lesson.englishLevel && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            style={{ background: '#EDE9FE', color: '#6D28D9' }}
          >
            {MATH_LEVEL_LABEL[lesson.englishLevel]}
          </span>
        )}

        {/* Chain badge — tells the user all levels will auto-place together */}
        {isGroup && siblingCount > 0 && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            title={`Dropping this will also place ${siblingCount} other level${siblingCount > 1 ? 's' : ''} at the same slot`}
            style={{ background: '#F0FDF4', color: '#15803D' }}
          >
            ⛓ +{siblingCount}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────

interface LessonPoolProps {
  lessons: Lesson[]
  entries: ScheduleEntry[]
  subjects: Subject[]
  teachers: Teacher[]
  grades: Grade[]
  classes: Class[]
  /** When set (from the editor's subject filter), only this subject's lessons are shown */
  filterSubjectId?: string
}

type TypeFilter = 'all' | 'groups' | 'regular'

export function LessonPool({
  lessons,
  entries,
  subjects,
  teachers,
  grades,
  classes,
  filterSubjectId,
}: LessonPoolProps) {
  const [filterGradeId, setFilterGradeId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<TypeFilter>('all')

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]))
  const gradeMap   = Object.fromEntries(grades.map(g => [g.id, g]))
  const classMap   = Object.fromEntries(classes.map(c => [c.id, c]))

  // Sort grades ascending for display
  const sortedGrades = [...grades].sort((a, b) => a.number - b.number)

  // Derive grade ID for any lesson (group lessons have gradeId; others derive from their first class)
  const lessonGradeId = (lesson: Lesson): string | null =>
    lesson.gradeId ?? (lesson.classIds[0] ? (classMap[lesson.classIds[0]]?.gradeId ?? null) : null)

  // Count placements per lesson
  const placedCount: Record<string, number> = {}
  for (const entry of entries) {
    placedCount[entry.lessonId] = (placedCount[entry.lessonId] ?? 0) + 1
  }

  // All unplaced items (before filters)
  const poolItems = lessons
    .map(lesson => ({
      lesson,
      remaining: lesson.hoursPerWeek - (placedCount[lesson.id] ?? 0),
    }))
    .filter(item => item.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)

  // Apply filters — filterSubjectId from the editor takes priority (used for "highlight a subject" mode)
  const filteredItems = poolItems.filter(({ lesson }) => {
    if (filterSubjectId && lesson.subjectId !== filterSubjectId) return false
    if (filterGradeId && lessonGradeId(lesson) !== filterGradeId) return false
    if (filterType === 'groups' && lesson.type !== LessonType.MATH_GROUP && lesson.type !== LessonType.ENGLISH_GROUP) return false
    if (filterType === 'regular' && (lesson.type === LessonType.MATH_GROUP || lesson.type === LessonType.ENGLISH_GROUP)) return false
    return true
  })

  // For group lessons: count how many unplaced siblings will auto-place alongside this one
  const groupSiblingCount = (lesson: Lesson): number => {
    if (lesson.type !== LessonType.MATH_GROUP && lesson.type !== LessonType.ENGLISH_GROUP) return 0
    return poolItems.filter(
      ({ lesson: l }) =>
        l.id !== lesson.id &&
        l.type === lesson.type &&
        l.gradeId === lesson.gradeId,
    ).length
  }

  const classLabels = (lesson: Lesson): string[] =>
    lesson.classIds.map(cid => {
      const cls = classMap[cid]
      const grade = cls ? gradeMap[cls.gradeId] : undefined
      return grade && cls ? `${grade.number}${cls.section}` : '?'
    })

  const chipBase = 'text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer select-none transition-colors'

  return (
    <div
      className="flex flex-col border-l"
      style={{
        width: 200,
        minWidth: 200,
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      {/* ── Header ── */}
      <div
        className="px-3 pt-2 pb-1.5 border-b space-y-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Lesson Pool
          </p>
          <p className="text-[11px] font-medium text-[var(--text-2)]">
            {filteredItems.length}
            {filteredItems.length !== poolItems.length && (
              <span className="text-[var(--text-3)]"> / {poolItems.length}</span>
            )}
          </p>
        </div>

        {/* Grade filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterGradeId(null)}
            className={chipBase}
            style={{
              background: !filterGradeId ? 'var(--accent)' : 'var(--surface-2)',
              color: !filterGradeId ? '#fff' : 'var(--text-2)',
            }}
          >
            All
          </button>
          {sortedGrades.map(g => (
            <button
              key={g.id}
              onClick={() => setFilterGradeId(prev => prev === g.id ? null : g.id)}
              className={chipBase}
              style={{
                background: filterGradeId === g.id ? 'var(--accent)' : 'var(--surface-2)',
                color: filterGradeId === g.id ? '#fff' : 'var(--text-2)',
              }}
            >
              {g.number}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex gap-1">
          {(['all', 'groups', 'regular'] as TypeFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={chipBase + ' flex-1 text-center'}
              style={{
                background: filterType === t ? 'var(--surface-2)' : 'transparent',
                color: filterType === t ? 'var(--text-1)' : 'var(--text-3)',
                border: filterType === t ? '1px solid var(--border)' : '1px solid transparent',
              }}
            >
              {t === 'all' ? 'All' : t === 'groups' ? 'Groups' : 'Regular'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Items ── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {poolItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[28px]">✓</p>
            <p className="text-[12px] font-medium text-[var(--ok-text)] mt-1">All placed!</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-[22px]">🔍</p>
            <p className="text-[11px] text-[var(--text-3)] mt-1">No lessons match the filter</p>
          </div>
        ) : (
          filteredItems.map(({ lesson, remaining }) => (
            <PoolItem
              key={lesson.id}
              lesson={lesson}
              remaining={remaining}
              subject={subjectMap[lesson.subjectId]}
              teacher={lesson.teacherId ? teacherMap[lesson.teacherId] : undefined}
              classLabels={classLabels(lesson)}
              siblingCount={groupSiblingCount(lesson)}
            />
          ))
        )}
      </div>
    </div>
  )
}
