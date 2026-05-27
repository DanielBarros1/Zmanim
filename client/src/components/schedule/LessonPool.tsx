/**
 * LessonPool — the right-side panel showing unplaced lessons.
 *
 * Shows all lessons that haven't been placed the required number of times.
 * Each lesson shows:
 *   - Color stripe (subject color)
 *   - Subject name (Hebrew)
 *   - Teacher name (Hebrew)
 *   - Class label(s)
 *   - Remaining placements needed (e.g. "2 more needed")
 *
 * Lessons are draggable: drag from pool to a grid cell to place them.
 * Uses useDraggable from @dnd-kit/core.
 *
 * Pool entries are sorted: lessons with most remaining hours first.
 */

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

interface PoolItemProps {
  lesson: Lesson
  remaining: number
  subject: Subject | undefined
  teacher: Teacher | undefined
  classLabels: string[]
}

function PoolItem({ lesson, remaining, subject, teacher, classLabels }: PoolItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${lesson.id}`,
    data: { type: 'pool', lessonId: lesson.id },
  })

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
        borderLeft: `3px solid ${subject?.color ?? '#94A3B8'}`,
        background: 'var(--card-bg)',
        border: `1px solid var(--border)`,
        borderLeftColor: subject?.color ?? '#94A3B8',
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
      </div>
    </div>
  )
}

interface LessonPoolProps {
  lessons: Lesson[]
  entries: ScheduleEntry[]
  subjects: Subject[]
  teachers: Teacher[]
  grades: Grade[]
  classes: Class[]
}

export function LessonPool({
  lessons,
  entries,
  subjects,
  teachers,
  grades,
  classes,
}: LessonPoolProps) {
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]))
  const gradeMap = Object.fromEntries(grades.map(g => [g.id, g]))
  const classMap = Object.fromEntries(classes.map(c => [c.id, c]))

  // Count placements per lesson
  const placedCount: Record<string, number> = {}
  for (const entry of entries) {
    placedCount[entry.lessonId] = (placedCount[entry.lessonId] ?? 0) + 1
  }

  // Build pool items: lessons with remaining > 0
  const poolItems = lessons
    .map(lesson => ({
      lesson,
      remaining: lesson.hoursPerWeek - (placedCount[lesson.id] ?? 0),
    }))
    .filter(item => item.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)

  const classLabels = (lesson: Lesson) =>
    lesson.classIds.map(cid => {
      const cls = classMap[cid]
      const grade = cls ? gradeMap[cls.gradeId] : undefined
      return grade && cls ? `${grade.number}${cls.section}` : '?'
    })

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
      <div
        className="px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">
          Lesson Pool
        </p>
        <p className="text-[12px] font-medium text-[var(--text-1)]">
          {poolItems.length} remaining
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {poolItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[28px]">✓</p>
            <p className="text-[12px] font-medium text-[var(--ok-text)] mt-1">All placed!</p>
          </div>
        ) : (
          poolItems.map(({ lesson, remaining }) => (
            <PoolItem
              key={lesson.id}
              lesson={lesson}
              remaining={remaining}
              subject={subjectMap[lesson.subjectId]}
              teacher={teacherMap[lesson.teacherId]}
              classLabels={classLabels(lesson)}
            />
          ))
        )}
      </div>
    </div>
  )
}
