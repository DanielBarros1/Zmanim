/**
 * LessonsPage — manage the lesson plan.
 *
 * Three lesson types (see product-spec.md §4):
 *
 *   REGULAR    — one class, one teacher, one subject, N hours/week
 *   SHARED     — two classes (same grade) share a lesson simultaneously
 *   MATH_GROUP — Israeli math grouping: 3pt/4pt/5pt groups spanning both
 *                classes of a grade. Each grade can have at most one math
 *                group per level. All math groups for a grade MUST be placed
 *                at the same time slot (hard invariant D3).
 *
 * The form adapts its fields based on the selected type.
 */

import { useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import {
  useLessons,
  useCreateLesson,
  useDeleteLesson,
} from '../../api/lessons'
import { useSubjects } from '../../api/subjects'
import { useTeachers } from '../../api/teachers'
import { useGrades, useClasses } from '../../api/grades'
import {
  LessonType,
  MathLevel,
  MATH_LEVEL_LABEL,
} from '@zmanim/shared'
import type { Lesson, Subject, Teacher, Grade, Class } from '@zmanim/shared'
import type { CreateLessonInput } from '../../api/lessons'

const TYPE_LABEL: Record<LessonType, string> = {
  [LessonType.REGULAR]: 'Regular',
  [LessonType.SHARED]: 'Shared (2 classes)',
  [LessonType.MATH_GROUP]: 'Math Group',
}

// ── Lesson Form ─────────────────────────────────────────────────

interface LessonFormProps {
  onSave: (data: CreateLessonInput) => void
  onCancel: () => void
  loading: boolean
  subjects: Subject[]
  teachers: Teacher[]
  grades: Grade[]
  classes: Class[]
}

function LessonForm({
  onSave,
  onCancel,
  loading,
  subjects,
  teachers,
  grades,
  classes,
}: LessonFormProps) {
  const [type, setType] = useState<LessonType>(LessonType.REGULAR)
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [hoursPerWeek, setHoursPerWeek] = useState(2)
  // REGULAR / SHARED
  const [classId1, setClassId1] = useState('')
  const [classId2, setClassId2] = useState('')
  // MATH_GROUP
  const [gradeId, setGradeId] = useState('')
  const [mathLevel, setMathLevel] = useState<MathLevel>(MathLevel.THREE_POINT)

  // Filter teachers who can teach the selected subject
  const eligibleTeachers = subjectId
    ? teachers.filter(t => t.subjectIds.includes(subjectId))
    : teachers

  // Grade classes (for SHARED: pick two from same grade)
  const classesForGrade = (gId: string) => classes.filter(c => c.gradeId === gId)

  const gradeOfClass = (cId: string) => {
    const cls = classes.find(c => c.id === cId)
    return cls ? grades.find(g => g.id === cls.gradeId) : undefined
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!subjectId || !teacherId) return

    if (type === LessonType.REGULAR) {
      if (!classId1) return
      onSave({ type, subjectId, teacherId, classIds: [classId1], hoursPerWeek })
    } else if (type === LessonType.SHARED) {
      if (!classId1 || !classId2) return
      const g1 = gradeOfClass(classId1)
      const g2 = gradeOfClass(classId2)
      if (!g1 || !g2 || g1.id !== g2.id) return // must be same grade
      onSave({
        type,
        subjectId,
        teacherId,
        classIds: [classId1, classId2],
        hoursPerWeek,
      })
    } else {
      if (!gradeId) return
      onSave({ type, subjectId, teacherId, gradeId, mathLevel, hoursPerWeek })
    }
  }

  // Group classes by grade for display
  const gradeClassOptions = grades.flatMap(g =>
    classesForGrade(g.id).map(c => ({
      value: c.id,
      label: `Grade ${g.number}${c.section}`,
    })),
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Lesson type"
        value={type}
        onChange={e => {
          setType(e.target.value as LessonType)
          setClassId1('')
          setClassId2('')
          setGradeId('')
        }}
      >
        {Object.values(LessonType).map(t => (
          <option key={t} value={t}>{TYPE_LABEL[t]}</option>
        ))}
      </Select>

      <Select
        label="Subject"
        value={subjectId}
        onChange={e => {
          setSubjectId(e.target.value)
          setTeacherId('') // reset teacher since eligibility may change
        }}
        required
      >
        <option value="">Select subject…</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </Select>

      <Select
        label="Teacher"
        value={teacherId}
        onChange={e => setTeacherId(e.target.value)}
        required
        disabled={!subjectId}
      >
        <option value="">
          {subjectId
            ? eligibleTeachers.length === 0
              ? 'No teachers for this subject'
              : 'Select teacher…'
            : 'Select subject first'}
        </option>
        {eligibleTeachers.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </Select>

      <Input
        label="Hours per week"
        type="number"
        min={1}
        max={10}
        value={hoursPerWeek}
        onChange={e => setHoursPerWeek(Number(e.target.value))}
        className="w-32"
      />

      {/* REGULAR — single class */}
      {type === LessonType.REGULAR && (
        <Select
          label="Class"
          value={classId1}
          onChange={e => setClassId1(e.target.value)}
          required
        >
          <option value="">Select class…</option>
          {gradeClassOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      )}

      {/* SHARED — two classes (same grade) */}
      {type === LessonType.SHARED && (
        <div className="space-y-3">
          <Select
            label="Class 1"
            value={classId1}
            onChange={e => { setClassId1(e.target.value); setClassId2('') }}
            required
          >
            <option value="">Select class…</option>
            {gradeClassOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          <Select
            label="Class 2 (must be same grade)"
            value={classId2}
            onChange={e => setClassId2(e.target.value)}
            required
            disabled={!classId1}
          >
            <option value="">Select class…</option>
            {gradeClassOptions
              .filter(o => {
                if (o.value === classId1) return false
                const g1 = gradeOfClass(classId1)
                const g2 = gradeOfClass(o.value)
                return g1 && g2 && g1.id === g2.id
              })
              .map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
          </Select>
          {classId1 && classId2 && gradeOfClass(classId1)?.id !== gradeOfClass(classId2)?.id && (
            <p className="text-[11px] text-red-500">
              Both classes must belong to the same grade.
            </p>
          )}
        </div>
      )}

      {/* MATH_GROUP — grade + level */}
      {type === LessonType.MATH_GROUP && (
        <div className="space-y-3">
          <Select
            label="Grade"
            value={gradeId}
            onChange={e => setGradeId(e.target.value)}
            required
          >
            <option value="">Select grade…</option>
            {grades.map(g => (
              <option key={g.id} value={g.id}>Grade {g.number}</option>
            ))}
          </Select>
          <Select
            label="Math level"
            value={mathLevel}
            onChange={e => setMathLevel(e.target.value as MathLevel)}
          >
            {Object.values(MathLevel).map(l => (
              <option key={l} value={l}>{MATH_LEVEL_LABEL[l]}</option>
            ))}
          </Select>
          <div
            className="px-3 py-2 rounded-md text-[12px] text-[var(--warn-text)]"
            style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}
          >
            ⚠ All math groups for this grade must be placed at the same slot (hard invariant).
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Save Lesson
        </Button>
      </div>
    </form>
  )
}

// ── Page ────────────────────────────────────────────────────────

function lessonSummary(
  lesson: Lesson,
  subjects: Subject[],
  teachers: Teacher[],
  grades: Grade[],
  classes: Class[],
) {
  const subject = subjects.find(s => s.id === lesson.subjectId)
  const teacher = teachers.find(t => t.id === lesson.teacherId)
  const classLabels = lesson.classIds.map(cid => {
    const cls = classes.find(c => c.id === cid)
    const grade = cls ? grades.find(g => g.id === cls.gradeId) : undefined
    return grade && cls ? `${grade.number}${cls.section}` : '?'
  })

  return { subject, teacher, classLabels }
}

export function LessonsPage() {
  const { data: lessons = [], isLoading } = useLessons()
  const { data: subjects = [] } = useSubjects()
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const createLesson = useCreateLesson()
  const deleteLesson = useDeleteLesson()

  const [modalOpen, setModalOpen] = useState(false)
  const [deletingLesson, setDeletingLesson] = useState<Lesson | null>(null)
  const [typeFilter, setTypeFilter] = useState<LessonType | 'ALL'>('ALL')

  const handleCreate = async (data: CreateLessonInput) => {
    await createLesson.mutateAsync(data)
    setModalOpen(false)
  }

  const handleDelete = async () => {
    if (!deletingLesson) return
    await deleteLesson.mutateAsync(deletingLesson.id)
    setDeletingLesson(null)
  }

  const filteredLessons = typeFilter === 'ALL'
    ? lessons
    : lessons.filter(l => l.type === typeFilter)

  if (isLoading) {
    return (
      <AppShell title="Lessons">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  const TYPE_BADGE_VARIANT: Record<LessonType, 'neutral' | 'accent' | 'warn'> = {
    [LessonType.REGULAR]: 'neutral',
    [LessonType.SHARED]: 'accent',
    [LessonType.MATH_GROUP]: 'warn',
  }

  return (
    <AppShell
      title="Lessons"
      actions={<Button onClick={() => setModalOpen(true)}>+ New Lesson</Button>}
    >
      {/* Type filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['ALL', ...Object.values(LessonType)] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={[
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              typeFilter === t
                ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]',
            ].join(' ')}
          >
            {t === 'ALL' ? `All (${lessons.length})` : `${TYPE_LABEL[t]} (${lessons.filter(l => l.type === t).length})`}
          </button>
        ))}
      </div>

      {filteredLessons.length === 0 ? (
        <EmptyState
          icon="📋"
          title={typeFilter === 'ALL' ? 'No lessons yet' : `No ${TYPE_LABEL[typeFilter as LessonType]} lessons`}
          description="Lessons define what must be placed in the schedule."
          action={<Button onClick={() => setModalOpen(true)}>+ New Lesson</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filteredLessons.map(lesson => {
            const { subject, teacher, classLabels } = lessonSummary(
              lesson, subjects, teachers, grades, classes,
            )
            return (
              <div
                key={lesson.id}
                className="flex items-center gap-4 px-4 py-3 rounded-lg border"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--border)',
                  borderLeft: subject ? `3px solid ${subject.color}` : undefined,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-1)] hebrew truncate">
                    {subject?.name ?? '—'}
                  </p>
                  <p className="text-[11px] text-[var(--text-3)] hebrew">
                    {teacher?.name ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={TYPE_BADGE_VARIANT[lesson.type]}>
                    {TYPE_LABEL[lesson.type]}
                  </Badge>
                  {lesson.mathLevel && (
                    <Badge variant="warn">{MATH_LEVEL_LABEL[lesson.mathLevel]}</Badge>
                  )}
                  <span className="text-[11px] text-[var(--text-2)]">
                    {classLabels.join(', ')}
                  </span>
                  <span className="text-[11px] text-[var(--text-3)]">
                    {lesson.hoursPerWeek}h/wk
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingLesson(lesson)}
                  className="text-red-500 hover:text-red-600"
                >
                  Delete
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Lesson" width="max-w-xl">
        <LessonForm
          onSave={handleCreate}
          onCancel={() => setModalOpen(false)}
          loading={createLesson.isPending}
          subjects={subjects}
          teachers={teachers}
          grades={grades}
          classes={classes}
        />
      </Modal>

      <ConfirmDialog
        open={!!deletingLesson}
        onClose={() => setDeletingLesson(null)}
        onConfirm={handleDelete}
        title="Delete lesson?"
        description="All schedule placements for this lesson will also be removed."
        confirmLabel="Delete Lesson"
        danger
        loading={deleteLesson.isPending}
      />
    </AppShell>
  )
}
