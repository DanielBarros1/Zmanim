/**
 * LessonsPage — manage the lesson plan.
 *
 * Lesson types (§4):
 *   REGULAR       — one class, one teacher, one subject, N hours/week
 *   SHARED        — two classes (same grade) share a lesson simultaneously
 *   PARALLEL      — two classes, one teacher per class, same time slot
 *   MATH_GROUP    — level groups spanning both classes of a grade (hard invariant D3)
 *   ENGLISH_GROUP — same grouping structure (hard invariant D4)
 *   MULTI_TEACHER — one room, two classes, multiple teachers simultaneously
 *
 * Features:
 *   - Type-tab + grade/subject/teacher/search filter bar
 *   - Sort by grade, subject, teacher, or hours (asc/desc)
 *   - Multi-select checkboxes with select-all (indeterminate)
 *   - Floating bulk bar: set h/wk, set teacher, delete N
 *   - Inline h/wk editing (click the hours badge)
 *   - Clone / Edit / Delete per-row
 */

import { useState, useMemo, useEffect, useRef } from 'react'
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
  useUpdateLesson,
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
import type { CreateLessonInput, LessonTeacherInput } from '../../api/lessons'

// ── Constants ────────────────────────────────────────────────────

const TYPE_LABEL: Record<LessonType, string> = {
  [LessonType.REGULAR]: 'Regular',
  [LessonType.SHARED]: 'Shared',
  [LessonType.PARALLEL]: 'Parallel',
  [LessonType.MATH_GROUP]: 'Math Group',
  [LessonType.ENGLISH_GROUP]: 'English Group',
  [LessonType.MULTI_TEACHER]: 'Multi-teacher',
}

const TYPE_BADGE_VARIANT: Record<LessonType, 'neutral' | 'accent' | 'warn' | 'ok'> = {
  [LessonType.REGULAR]: 'neutral',
  [LessonType.SHARED]: 'accent',
  [LessonType.PARALLEL]: 'accent',
  [LessonType.MATH_GROUP]: 'warn',
  [LessonType.ENGLISH_GROUP]: 'ok',
  [LessonType.MULTI_TEACHER]: 'warn',
}

/** Lesson types that carry a single primary teacherId (bulk teacher-set applies to these). */
const SINGLE_TEACHER_TYPES: LessonType[] = [
  LessonType.REGULAR,
  LessonType.SHARED,
  LessonType.MATH_GROUP,
  LessonType.ENGLISH_GROUP,
]

/** Shared Tailwind classes for compact filter/sort `<select>` and `<button>` controls. */
const FILTER_CLS =
  'text-[12px] px-2 py-1.5 rounded-md border bg-[var(--surface)] border-[var(--border)] ' +
  'text-[var(--text-1)] focus:outline-none cursor-pointer hover:border-[var(--accent-border,var(--border))]'

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Reconstruct a full CreateLessonInput from an existing Lesson.
 * Used for inline h/wk edits and bulk teacher assignment so we can
 * pass the full required shape to the update mutation.
 */
function lessonToInput(lesson: Lesson): CreateLessonInput {
  const base = { subjectId: lesson.subjectId, hoursPerWeek: lesson.hoursPerWeek }
  switch (lesson.type) {
    case LessonType.REGULAR:
      return {
        ...base,
        type: LessonType.REGULAR,
        teacherId: lesson.teacherId!,
        classIds: lesson.classIds as [string],
      }
    case LessonType.SHARED:
      return {
        ...base,
        type: LessonType.SHARED,
        teacherId: lesson.teacherId!,
        classIds: lesson.classIds as [string, string],
      }
    case LessonType.PARALLEL:
      return {
        ...base,
        type: LessonType.PARALLEL,
        classIds: lesson.classIds as [string, string],
        lessonTeachers: lesson.lessonTeachers as [LessonTeacherInput, LessonTeacherInput],
      }
    case LessonType.MATH_GROUP:
      return {
        ...base,
        type: LessonType.MATH_GROUP,
        teacherId: lesson.teacherId!,
        gradeId: lesson.gradeId!,
        mathLevel: lesson.mathLevel!,
      }
    case LessonType.ENGLISH_GROUP:
      return {
        ...base,
        type: LessonType.ENGLISH_GROUP,
        teacherId: lesson.teacherId!,
        gradeId: lesson.gradeId!,
        englishLevel: lesson.englishLevel!,
      }
    case LessonType.MULTI_TEACHER:
      return {
        ...base,
        type: LessonType.MULTI_TEACHER,
        classIds: lesson.classIds as [string, string],
        lessonTeachers: lesson.lessonTeachers,
      }
    default: {
      const _: never = lesson.type
      throw new Error(`Unknown lesson type: ${_}`)
    }
  }
}

function lessonSummary(
  lesson: Lesson,
  subjects: Subject[],
  teachers: Teacher[],
  grades: Grade[],
  classes: Class[],
) {
  const subject = subjects.find(s => s.id === lesson.subjectId)
  // For PARALLEL / MULTI_TEACHER, teacherId is null — names come from lessonTeachers
  const teacherNames: string[] = lesson.teacherId
    ? [teachers.find(t => t.id === lesson.teacherId)?.name ?? '—']
    : lesson.lessonTeachers.map(lt => teachers.find(t => t.id === lt.teacherId)?.name ?? '?')
  const classLabels = lesson.classIds.map(cid => {
    const cls = classes.find(c => c.id === cid)
    const grade = cls ? grades.find(g => g.id === cls.gradeId) : undefined
    return grade && cls ? `${grade.number}${cls.section}` : '?'
  })
  return { subject, teacherNames, classLabels }
}

// ── Lesson Form ─────────────────────────────────────────────────

interface LessonFormProps {
  onSave: (data: CreateLessonInput) => void
  onCancel: () => void
  loading: boolean
  error?: string
  subjects: Subject[]
  teachers: Teacher[]
  grades: Grade[]
  classes: Class[]
  /** Pre-fill values for clone / edit flow */
  initialValues?: Partial<{
    type: LessonType
    subjectId: string
    teacherId: string
    classId1: string
    classId2: string
    gradeId: string
    mathLevel: MathLevel
    englishLevel: MathLevel
    hoursPerWeek: number
    /** PARALLEL: two entries with classId; MULTI_TEACHER: entries with classId=null */
    lessonTeachers: LessonTeacherInput[]
  }>
}

function LessonForm({
  onSave,
  onCancel,
  loading,
  error,
  subjects,
  teachers,
  grades,
  classes,
  initialValues,
}: LessonFormProps) {
  const [type, setType] = useState<LessonType>(initialValues?.type ?? LessonType.REGULAR)
  const [subjectId, setSubjectId] = useState(initialValues?.subjectId ?? '')
  const [teacherId, setTeacherId] = useState(initialValues?.teacherId ?? '')
  const [hoursPerWeek, setHoursPerWeek] = useState(initialValues?.hoursPerWeek ?? 2)
  // REGULAR / SHARED / PARALLEL / MULTI_TEACHER
  const [classId1, setClassId1] = useState(initialValues?.classId1 ?? '')
  const [classId2, setClassId2] = useState(initialValues?.classId2 ?? '')
  // MATH_GROUP / ENGLISH_GROUP
  const [gradeId, setGradeId] = useState(initialValues?.gradeId ?? '')
  const [mathLevel, setMathLevel] = useState<MathLevel>(initialValues?.mathLevel ?? MathLevel.THREE_POINT)
  const [englishLevel, setEnglishLevel] = useState<MathLevel>(
    (initialValues?.englishLevel ?? MathLevel.THREE_POINT) as MathLevel,
  )
  // PARALLEL: teacherId per class
  const [parallelTeacher1, setParallelTeacher1] = useState(
    initialValues?.lessonTeachers?.[0]?.teacherId ?? '',
  )
  const [parallelTeacher2, setParallelTeacher2] = useState(
    initialValues?.lessonTeachers?.[1]?.teacherId ?? '',
  )
  // MULTI_TEACHER: list of teacher IDs
  const [multiTeachers, setMultiTeachers] = useState<string[]>(
    initialValues?.lessonTeachers?.map(lt => lt.teacherId) ?? ['', ''],
  )

  // Filter teachers who can teach the selected subject
  const eligibleTeachers = subjectId
    ? teachers.filter(t => t.subjectIds.includes(subjectId))
    : teachers

  const classesForGrade = (gId: string) => classes.filter(c => c.gradeId === gId)

  const gradeOfClass = (cId: string) => {
    const cls = classes.find(c => c.id === cId)
    return cls ? grades.find(g => g.id === cls.gradeId) : undefined
  }

  // Options for class selects — sorted by grade number then section
  const gradeClassOptions = grades
    .slice()
    .sort((a, b) => a.number - b.number)
    .flatMap(g =>
      classesForGrade(g.id).map(c => ({
        value: c.id,
        label: `Grade ${g.number}${c.section}`,
      })),
    )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!subjectId) return

    if (type === LessonType.REGULAR) {
      if (!classId1 || !teacherId) return
      onSave({ type, subjectId, teacherId, classIds: [classId1], hoursPerWeek })
    } else if (type === LessonType.SHARED) {
      if (!classId1 || !classId2 || !teacherId) return
      const g1 = gradeOfClass(classId1)
      const g2 = gradeOfClass(classId2)
      if (!g1 || !g2 || g1.id !== g2.id) return
      onSave({ type, subjectId, teacherId, classIds: [classId1, classId2], hoursPerWeek })
    } else if (type === LessonType.PARALLEL) {
      if (!classId1 || !classId2 || !parallelTeacher1 || !parallelTeacher2) return
      const g1 = gradeOfClass(classId1)
      const g2 = gradeOfClass(classId2)
      if (!g1 || !g2 || g1.id !== g2.id) return
      onSave({
        type,
        subjectId,
        classIds: [classId1, classId2],
        hoursPerWeek,
        lessonTeachers: [
          { teacherId: parallelTeacher1, classId: classId1 },
          { teacherId: parallelTeacher2, classId: classId2 },
        ],
      })
    } else if (type === LessonType.MATH_GROUP) {
      if (!gradeId || !teacherId) return
      onSave({ type, subjectId, teacherId, gradeId, mathLevel, hoursPerWeek })
    } else if (type === LessonType.ENGLISH_GROUP) {
      if (!gradeId || !teacherId) return
      onSave({ type, subjectId, teacherId, gradeId, englishLevel, hoursPerWeek })
    } else if (type === LessonType.MULTI_TEACHER) {
      if (!classId1 || !classId2) return
      const valid = multiTeachers.filter(Boolean)
      if (valid.length < 2) return
      const g1 = gradeOfClass(classId1)
      const g2 = gradeOfClass(classId2)
      if (!g1 || !g2 || g1.id !== g2.id) return
      onSave({
        type,
        subjectId,
        classIds: [classId1, classId2],
        hoursPerWeek,
        lessonTeachers: valid.map(tid => ({ teacherId: tid, classId: null })),
      })
    }
  }

  const isGroupType = type === LessonType.MATH_GROUP || type === LessonType.ENGLISH_GROUP
  const needsSingleTeacher = type === LessonType.REGULAR || type === LessonType.SHARED || isGroupType

  // Two-class picker — shared between SHARED, PARALLEL, MULTI_TEACHER
  const TwoClassPicker = (
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
        <p className="text-[11px] text-red-500">Both classes must belong to the same grade.</p>
      )}
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Lesson type"
        value={type}
        onChange={e => {
          setType(e.target.value as LessonType)
          setClassId1(''); setClassId2(''); setGradeId('')
          setTeacherId(''); setParallelTeacher1(''); setParallelTeacher2('')
          setMultiTeachers(['', ''])
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
          setTeacherId(''); setParallelTeacher1(''); setParallelTeacher2('')
          setMultiTeachers(['', ''])
        }}
        required
      >
        <option value="">Select subject…</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </Select>

      {/* Single teacher — REGULAR, SHARED, MATH_GROUP, ENGLISH_GROUP */}
      {needsSingleTeacher && (
        <Select
          label="Teacher"
          value={teacherId}
          onChange={e => setTeacherId(e.target.value)}
          required
          disabled={!subjectId}
        >
          <option value="">
            {subjectId
              ? eligibleTeachers.length === 0 ? 'No teachers for this subject' : 'Select teacher…'
              : 'Select subject first'}
          </option>
          {eligibleTeachers.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      )}

      <Input
        label="Hours per week"
        type="number"
        min={1}
        max={10}
        value={hoursPerWeek}
        onChange={e => setHoursPerWeek(Number(e.target.value) || 1)}
        className="w-32"
      />

      {/* REGULAR — single class */}
      {type === LessonType.REGULAR && (
        <Select label="Class" value={classId1} onChange={e => setClassId1(e.target.value)} required>
          <option value="">Select class…</option>
          {gradeClassOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      )}

      {/* SHARED — two classes, shared teacher */}
      {type === LessonType.SHARED && TwoClassPicker}

      {/* PARALLEL — two classes, one teacher per class */}
      {type === LessonType.PARALLEL && (
        <div className="space-y-3">
          {TwoClassPicker}
          <div
            className="px-3 py-2 rounded-md text-[12px] text-[var(--accent-text)]"
            style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border, var(--border))' }}
          >
            Each class gets its own teacher and room at the same time slot.
          </div>
          <Select
            label={classId1 ? `Teacher for ${gradeClassOptions.find(o => o.value === classId1)?.label ?? 'Class 1'}` : 'Teacher for Class 1'}
            value={parallelTeacher1}
            onChange={e => setParallelTeacher1(e.target.value)}
            required
            disabled={!subjectId}
          >
            <option value="">{subjectId ? 'Select teacher…' : 'Select subject first'}</option>
            {eligibleTeachers.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select
            label={classId2 ? `Teacher for ${gradeClassOptions.find(o => o.value === classId2)?.label ?? 'Class 2'}` : 'Teacher for Class 2'}
            value={parallelTeacher2}
            onChange={e => setParallelTeacher2(e.target.value)}
            required
            disabled={!subjectId}
          >
            <option value="">{subjectId ? 'Select teacher…' : 'Select subject first'}</option>
            {eligibleTeachers.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      )}

      {/* MULTI_TEACHER — two classes, shared room, multiple teachers */}
      {type === LessonType.MULTI_TEACHER && (
        <div className="space-y-3">
          {TwoClassPicker}
          <div
            className="px-3 py-2 rounded-md text-[12px] text-[var(--warn-text)]"
            style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}
          >
            All teachers share one room with both classes simultaneously.
          </div>
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-[var(--text-2)]">Teachers (min. 2)</p>
            {multiTeachers.map((tid, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Select
                  label=""
                  value={tid}
                  onChange={e => {
                    const next = [...multiTeachers]
                    next[i] = e.target.value
                    setMultiTeachers(next)
                  }}
                  disabled={!subjectId}
                >
                  <option value="">{subjectId ? 'Select teacher…' : 'Select subject first'}</option>
                  {eligibleTeachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
                {multiTeachers.length > 2 && (
                  <button
                    type="button"
                    className="text-[11px] text-red-500 hover:text-red-600 shrink-0"
                    onClick={() => setMultiTeachers(multiTeachers.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMultiTeachers([...multiTeachers, ''])}
            >
              + Add teacher
            </Button>
          </div>
        </div>
      )}

      {/* MATH_GROUP / ENGLISH_GROUP — grade + level */}
      {isGroupType && (
        <div className="space-y-3">
          <Select label="Grade" value={gradeId} onChange={e => setGradeId(e.target.value)} required>
            <option value="">Select grade…</option>
            {grades.map(g => (
              <option key={g.id} value={g.id}>Grade {g.number}</option>
            ))}
          </Select>
          <Select
            label={type === LessonType.MATH_GROUP ? 'Math level' : 'English level'}
            value={type === LessonType.MATH_GROUP ? mathLevel : englishLevel}
            onChange={e => {
              if (type === LessonType.MATH_GROUP) setMathLevel(e.target.value as MathLevel)
              else setEnglishLevel(e.target.value as MathLevel)
            }}
          >
            {Object.values(MathLevel).map(l => (
              <option key={l} value={l}>{MATH_LEVEL_LABEL[l]}</option>
            ))}
          </Select>
          <div
            className="px-3 py-2 rounded-md text-[12px] text-[var(--warn-text)]"
            style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}
          >
            ⚠ All {type === LessonType.MATH_GROUP ? 'math' : 'English'} groups for this grade must
            be placed at the same slot (hard invariant).
          </div>
        </div>
      )}

      {error && (
        <p
          className="text-[12px] text-red-500 rounded-md px-3 py-2"
          style={{ background: 'var(--warn-bg)' }}
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Save Lesson</Button>
      </div>
    </form>
  )
}

// ── Page ────────────────────────────────────────────────────────

type SortBy = 'grade' | 'subject' | 'teacher' | 'hours'

export function LessonsPage() {
  // ── Data ──
  const { data: lessons = [], isLoading } = useLessons()
  const { data: subjects = [] } = useSubjects()
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const createLesson = useCreateLesson()
  const updateLesson = useUpdateLesson()
  const deleteLesson = useDeleteLesson()

  // ── Modal / per-row action state ──
  const [modalOpen, setModalOpen] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>()
  const [cloneSource, setCloneSource] = useState<Lesson | null>(null)
  const [cloneError, setCloneError] = useState<string | undefined>()
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null)
  const [editError, setEditError] = useState<string | undefined>()
  const [deletingLesson, setDeletingLesson] = useState<Lesson | null>(null)
  const [deleteError, setDeleteError] = useState<string | undefined>()

  // ── Filters & sort ──
  const [typeFilter, setTypeFilter] = useState<LessonType | 'ALL'>('ALL')
  const [gradeFilter, setGradeFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [teacherFilter, setTeacherFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('grade')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // ── Multi-select ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)

  // ── Bulk actions ──
  const [bulkHours, setBulkHours] = useState(2)
  const [bulkTeacherId, setBulkTeacherId] = useState('')
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState<string | undefined>()
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | undefined>()

  // ── Inline h/wk editing ──
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [inlineHours, setInlineHours] = useState(1)
  // Ref prevents double-save when both form-submit and blur fire
  const inlineSavingRef = useRef(false)

  // ── Lookup maps (memoised) ──
  const subjectsById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects])
  const teachersById = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers])
  const classesById  = useMemo(() => new Map(classes.map(c => [c.id, c])),  [classes])
  const gradesById   = useMemo(() => new Map(grades.map(g => [g.id, g])),   [grades])

  const sortedGrades    = useMemo(() => [...grades].sort((a, b) => a.number - b.number), [grades])
  const sortedSubjects  = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name)), [subjects])
  const sortedTeachers  = useMemo(() => [...teachers].sort((a, b) => a.name.localeCompare(b.name)), [teachers])

  // ── Filtered + sorted lessons ──
  // totalHours sums hoursPerWeek across all currently visible lessons.
  // When a grade/subject/teacher filter is active this gives the h/wk total
  // for that slice — the primary use case is "how many hours planned for grade X?".
  const filteredLessons = useMemo(() => {
    let result = [...lessons]

    if (typeFilter !== 'ALL') result = result.filter(l => l.type === typeFilter)

    if (gradeFilter) {
      // gradeFilter holds either a gradeId OR a classId (class-level filtering).
      // Distinguish by checking which map contains it.
      if (classesById.has(gradeFilter)) {
        // Class-level filter (e.g. "9A"): include lessons directly involving this
        // class, plus MATH_GROUP / ENGLISH_GROUP lessons for its grade (they affect
        // all classes in the grade, including this one).
        const cls = classesById.get(gradeFilter)!
        result = result.filter(l =>
          l.classIds.includes(gradeFilter) ||
          (l.gradeId != null && l.gradeId === cls.gradeId),
        )
      } else {
        // Grade-level filter (e.g. "Grade 9"): include all lessons for any class
        // in this grade, plus group lessons whose gradeId matches.
        result = result.filter(l =>
          l.gradeId === gradeFilter ||
          l.classIds.some(cid => classesById.get(cid)?.gradeId === gradeFilter),
        )
      }
    }

    if (subjectFilter) result = result.filter(l => l.subjectId === subjectFilter)

    if (teacherFilter) {
      result = result.filter(l =>
        l.teacherId === teacherFilter ||
        l.lessonTeachers.some(lt => lt.teacherId === teacherFilter),
      )
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(l => {
        const sName = subjectsById.get(l.subjectId)?.name.toLowerCase() ?? ''
        const tName = l.teacherId
          ? (teachersById.get(l.teacherId)?.name.toLowerCase() ?? '')
          : l.lessonTeachers
              .map(lt => teachersById.get(lt.teacherId)?.name.toLowerCase() ?? '')
              .join(' ')
        return sName.includes(q) || tName.includes(q)
      })
    }

    result.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'subject': {
          const an = subjectsById.get(a.subjectId)?.name ?? ''
          const bn = subjectsById.get(b.subjectId)?.name ?? ''
          cmp = an.localeCompare(bn, 'he')
          break
        }
        case 'teacher': {
          const an = a.teacherId ? (teachersById.get(a.teacherId)?.name ?? '') : ''
          const bn = b.teacherId ? (teachersById.get(b.teacherId)?.name ?? '') : ''
          cmp = an.localeCompare(bn, 'he')
          break
        }
        case 'grade': {
          const gradeNum = (l: Lesson) => {
            if (l.gradeId) return gradesById.get(l.gradeId)?.number ?? 999
            const c = classesById.get(l.classIds[0])
            return c ? (gradesById.get(c.gradeId)?.number ?? 999) : 999
          }
          const sectionCode = (l: Lesson) => {
            if (l.gradeId) return 0
            return classesById.get(l.classIds[0])?.section.charCodeAt(0) ?? 0
          }
          cmp = gradeNum(a) - gradeNum(b)
          if (cmp === 0) cmp = sectionCode(a) - sectionCode(b)
          if (cmp === 0) {
            // tertiary: subject name
            const an = subjectsById.get(a.subjectId)?.name ?? ''
            const bn = subjectsById.get(b.subjectId)?.name ?? ''
            cmp = an.localeCompare(bn, 'he')
          }
          break
        }
        case 'hours':
          cmp = a.hoursPerWeek - b.hoursPerWeek
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [
    lessons, typeFilter, gradeFilter, subjectFilter, teacherFilter, search,
    sortBy, sortDir, subjectsById, teachersById, classesById, gradesById,
  ])

  const totalHours = useMemo(() => {
    // When filtering by a specific class (e.g. 7A), MATH_GROUP and ENGLISH_GROUP
    // lessons must be deduplicated before summing.
    //
    // Why: each level group is a separate lesson record (3pt, 4pt, 5pt), but the
    // D3/D4 invariant forces ALL groups for a grade to run at the exact same time
    // slots. From 7A's perspective they only occupy those N slots once — a 7A student
    // attends exactly one group. Counting all three separately inflates the total.
    //
    // Dedup key: (type, gradeId) — keep only the first group's hoursPerWeek.
    // For grade-level or unfiltered views, no dedup is needed (the overcounting
    // cancels out when you look at the whole grade together).
    const isClassFilter = gradeFilter !== '' && classesById.has(gradeFilter)
    if (!isClassFilter) {
      return filteredLessons.reduce((sum, l) => sum + l.hoursPerWeek, 0)
    }
    const seenGroupKeys = new Set<string>()
    let total = 0
    for (const l of filteredLessons) {
      if (
        (l.type === LessonType.MATH_GROUP || l.type === LessonType.ENGLISH_GROUP) &&
        l.gradeId != null
      ) {
        const key = `${l.type}:${l.gradeId}`
        if (seenGroupKeys.has(key)) continue  // simultaneous — don't double-count
        seenGroupKeys.add(key)
      }
      total += l.hoursPerWeek
    }
    return total
  }, [filteredLessons, gradeFilter, classesById])

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [typeFilter, gradeFilter, subjectFilter, teacherFilter, search])

  // Update select-all checkbox indeterminate state
  useEffect(() => {
    if (!selectAllRef.current) return
    const n = selectedIds.size
    const total = filteredLessons.length
    selectAllRef.current.checked = n > 0 && n === total
    selectAllRef.current.indeterminate = n > 0 && n < total
  }, [selectedIds, filteredLessons])

  // ── Handlers ──

  const openCreate = () => {
    setCloneSource(null)
    setCreateError(undefined)
    setModalOpen(true)
  }

  const openClone = (lesson: Lesson) => {
    setCloneSource(lesson)
    setCloneError(undefined)
    setModalOpen(true)
  }

  const openEdit = (lesson: Lesson) => {
    setEditingLesson(lesson)
    setEditError(undefined)
  }

  const handleCreate = async (data: CreateLessonInput) => {
    setCreateError(undefined)
    setCloneError(undefined)
    try {
      await createLesson.mutateAsync(data)
      setModalOpen(false)
      setCloneSource(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to save lesson. Please try again.'
      if (cloneSource) setCloneError(msg)
      else setCreateError(msg)
    }
  }

  const handleUpdate = async (data: CreateLessonInput) => {
    if (!editingLesson) return
    setEditError(undefined)
    try {
      await updateLesson.mutateAsync({ id: editingLesson.id, data })
      setEditingLesson(null)
    } catch (err: any) {
      setEditError(err?.response?.data?.error ?? 'Failed to update lesson. Please try again.')
    }
  }

  const handleDelete = async () => {
    if (!deletingLesson) return
    setDeleteError(undefined)
    try {
      await deleteLesson.mutateAsync(deletingLesson.id)
      setDeletingLesson(null)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error ?? 'Failed to delete lesson.')
    }
  }

  const handleInlineSave = async (lesson: Lesson) => {
    if (inlineSavingRef.current) return
    inlineSavingRef.current = true
    setInlineEditId(null)
    if (inlineHours >= 1 && inlineHours <= 10) {
      try {
        const input = lessonToInput(lesson)
        await updateLesson.mutateAsync({ id: lesson.id, data: { ...input, hoursPerWeek: inlineHours } })
      } catch {
        // Silently fail — React Query will revert to server state on next refetch
      }
    }
    inlineSavingRef.current = false
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLessons.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredLessons.map(l => l.id)))
    }
  }

  const handleBulkHours = async () => {
    if (!bulkHours || bulkHours < 1) return
    setBulkPending(true)
    setBulkError(undefined)
    try {
      const targets = lessons.filter(l => selectedIds.has(l.id))
      for (const lesson of targets) {
        const input = lessonToInput(lesson)
        await updateLesson.mutateAsync({ id: lesson.id, data: { ...input, hoursPerWeek: bulkHours } })
      }
      setSelectedIds(new Set())
    } catch (err: any) {
      setBulkError(err?.response?.data?.error ?? 'Bulk update failed.')
    }
    setBulkPending(false)
  }

  const handleBulkTeacher = async () => {
    if (!bulkTeacherId) return
    setBulkPending(true)
    setBulkError(undefined)
    try {
      const targets = lessons.filter(
        l => selectedIds.has(l.id) && SINGLE_TEACHER_TYPES.includes(l.type),
      )
      for (const lesson of targets) {
        const input = lessonToInput(lesson)
        // teacherId exists on all SINGLE_TEACHER_TYPES inputs — cast is safe
        await updateLesson.mutateAsync({
          id: lesson.id,
          data: { ...input, teacherId: bulkTeacherId } as CreateLessonInput,
        })
      }
      setSelectedIds(new Set())
    } catch (err: any) {
      setBulkError(err?.response?.data?.error ?? 'Bulk update failed.')
    }
    setBulkPending(false)
  }

  const handleBulkDelete = async () => {
    setBulkPending(true)
    setBulkDeleteError(undefined)
    try {
      for (const id of selectedIds) {
        await deleteLesson.mutateAsync(id)
      }
      setSelectedIds(new Set())
      setBulkConfirmDelete(false)
    } catch (err: any) {
      setBulkDeleteError(err?.response?.data?.error ?? 'Bulk delete failed.')
    }
    setBulkPending(false)
  }

  const resetFilters = () => {
    setTypeFilter('ALL')
    setGradeFilter('')
    setSubjectFilter('')
    setTeacherFilter('')
    setSearch('')
  }

  const hasActiveFilters =
    typeFilter !== 'ALL' || gradeFilter || subjectFilter || teacherFilter || search.trim()

  const cloneInitialValues = (l: Lesson) => ({
    type: l.type,
    subjectId: l.subjectId,
    teacherId: l.teacherId ?? undefined,
    hoursPerWeek: l.hoursPerWeek,
    gradeId: l.gradeId ?? undefined,
    mathLevel: l.mathLevel ?? MathLevel.THREE_POINT,
    englishLevel: (l.englishLevel ?? MathLevel.THREE_POINT) as MathLevel,
    classId1: l.classIds[0] ?? '',
    classId2: l.classIds[1] ?? '',
    lessonTeachers: l.lessonTeachers.length > 0 ? l.lessonTeachers : undefined,
  })

  // How many of the currently selected lessons accept a single teacher (for bulk-teacher label)
  const selectedSingleTeacherCount = useMemo(
    () =>
      [...selectedIds].filter(id => {
        const l = lessons.find(x => x.id === id)
        return l && SINGLE_TEACHER_TYPES.includes(l.type)
      }).length,
    [selectedIds, lessons],
  )

  // ── Loading state ──
  if (isLoading) {
    return (
      <AppShell title="Lessons">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  // ── Render ──
  return (
    <AppShell
      title="Lessons"
      actions={<Button onClick={openCreate}>+ New Lesson</Button>}
    >
      {/* ── Type filter tabs ── */}
      <div className="flex flex-wrap gap-1 mb-3">
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
            {t === 'ALL'
              ? `All (${lessons.length})`
              : `${TYPE_LABEL[t]} (${lessons.filter(l => l.type === t).length})`}
          </button>
        ))}
      </div>

      {/* ── Filter & sort bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Grade / Class filter — optgroups let you pick a whole grade or a single class */}
        <select
          className={FILTER_CLS}
          value={gradeFilter}
          onChange={e => setGradeFilter(e.target.value)}
          title="Filter by grade or class"
        >
          <option value="">All grades</option>
          {sortedGrades.map(g => {
            const gradeClasses = classes
              .filter(c => c.gradeId === g.id)
              .sort((a, b) => a.section.localeCompare(b.section))
            return (
              <optgroup key={g.id} label={`── Grade ${g.number} ──`}>
                <option value={g.id}>Grade {g.number} (all)</option>
                {gradeClasses.map(c => (
                  <option key={c.id} value={c.id}>{g.number}{c.section}</option>
                ))}
              </optgroup>
            )
          })}
        </select>

        {/* Subject */}
        <select
          className={FILTER_CLS}
          value={subjectFilter}
          onChange={e => setSubjectFilter(e.target.value)}
          title="Filter by subject"
        >
          <option value="">All subjects</option>
          {sortedSubjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Teacher */}
        <select
          className={FILTER_CLS}
          value={teacherFilter}
          onChange={e => setTeacherFilter(e.target.value)}
          title="Filter by teacher"
        >
          <option value="">All teachers</option>
          {sortedTeachers.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {/* Free-text search */}
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={FILTER_CLS + ' w-36'}
        />

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="text-[12px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors px-1"
            title="Clear all filters"
          >
            ✕ Reset
          </button>
        )}

        {/* Sort controls — pushed right */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-3)]">Sort:</span>
          <select
            className={FILTER_CLS}
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
          >
            <option value="grade">Grade</option>
            <option value="subject">Subject</option>
            <option value="teacher">Teacher</option>
            <option value="hours">Hours</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className={FILTER_CLS + ' font-mono w-8 text-center'}
            title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* ── Selection / summary header row ── */}
      {filteredLessons.length > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 mb-1.5 rounded-md text-[12px] text-[var(--text-3)]"
          style={{ background: 'var(--surface-2)' }}
        >
          <input
            ref={selectAllRef}
            type="checkbox"
            className="cursor-pointer"
            onChange={toggleSelectAll}
            title="Select / deselect all visible lessons"
          />

          {/* Lesson count */}
          <span>
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : `${filteredLessons.length} lesson${filteredLessons.length !== 1 ? 's' : ''}`}
            {filteredLessons.length !== lessons.length && (
              <span className="ml-0.5 opacity-60">(of {lessons.length})</span>
            )}
          </span>

          {/* Hours total — the main summary stat */}
          <span className="text-[var(--text-3)]">·</span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: 'var(--text-1)' }}
            title={`Total hours per week for the ${hasActiveFilters ? 'filtered' : 'full'} lesson set`}
          >
            {totalHours} h/wk
          </span>

          {/* Label clarifies what the total covers when a filter is active */}
          {hasActiveFilters && (
            <span className="text-[10px] opacity-60">
              {gradeFilter
                ? (() => {
                    if (classesById.has(gradeFilter)) {
                      // Class-level: show "9A"
                      const cls = classesById.get(gradeFilter)!
                      const g = gradesById.get(cls.gradeId)
                      return `— ${g ? `${g.number}${cls.section}` : cls.section}`
                    }
                    // Grade-level: show "Grade 9"
                    return `— Grade ${sortedGrades.find(g => g.id === gradeFilter)?.number ?? '?'}`
                  })()
                : subjectFilter
                ? `— ${subjects.find(s => s.id === subjectFilter)?.name ?? '?'}`
                : teacherFilter
                ? `— ${teachers.find(t => t.id === teacherFilter)?.name ?? '?'}`
                : '— filtered'}
            </span>
          )}

          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] hover:text-[var(--text-1)] ml-1 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Lesson list ── */}
      {filteredLessons.length === 0 ? (
        <EmptyState
          icon="📋"
          title={hasActiveFilters ? 'No lessons match your filters' : 'No lessons yet'}
          description={
            hasActiveFilters
              ? 'Try adjusting the grade, subject, or teacher filters.'
              : 'Lessons define what must be placed in the schedule.'
          }
          action={!hasActiveFilters ? <Button onClick={openCreate}>+ New Lesson</Button> : undefined}
        />
      ) : (
        <div className="space-y-1 pb-20">
          {filteredLessons.map(lesson => {
            const { subject, teacherNames, classLabels } = lessonSummary(
              lesson, subjects, teachers, grades, classes,
            )
            const isSelected  = selectedIds.has(lesson.id)
            const isInlineEdit = inlineEditId === lesson.id

            return (
              <div
                key={lesson.id}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                  isSelected
                    ? 'bg-[var(--accent-bg)] border-[var(--accent-border,var(--border))]'
                    : 'bg-[var(--surface)] border-[var(--border)]',
                ].join(' ')}
                style={{
                  borderLeft: subject ? `3px solid ${subject.color}` : undefined,
                }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(lesson.id)}
                  className="cursor-pointer shrink-0"
                />

                {/* Subject + teacher(s) */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-1)] hebrew truncate">
                    {subject?.name ?? '—'}
                  </p>
                  <p className="text-[11px] text-[var(--text-3)] hebrew truncate">
                    {teacherNames.join(' · ')}
                  </p>
                </div>

                {/* Badges + class labels + hours */}
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={TYPE_BADGE_VARIANT[lesson.type]}>
                    {TYPE_LABEL[lesson.type]}
                  </Badge>
                  {lesson.mathLevel && (
                    <Badge variant="warn">{MATH_LEVEL_LABEL[lesson.mathLevel]}</Badge>
                  )}
                  {lesson.englishLevel && (
                    <Badge variant="ok">{MATH_LEVEL_LABEL[lesson.englishLevel]}</Badge>
                  )}
                  <span className="text-[11px] text-[var(--text-2)] font-mono">
                    {classLabels.join(', ')}
                  </span>

                  {/* Inline h/wk editor */}
                  {isInlineEdit ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={e => { e.preventDefault(); void handleInlineSave(lesson) }}
                    >
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={inlineHours}
                        autoFocus
                        onChange={e => setInlineHours(Number(e.target.value) || 1)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { setInlineEditId(null) }
                        }}
                        onBlur={() => void handleInlineSave(lesson)}
                        className="w-12 text-center text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:border-[var(--accent-border,var(--border))]"
                      />
                      <span className="text-[11px] text-[var(--text-3)]">h/wk</span>
                    </form>
                  ) : (
                    <button
                      onClick={() => {
                        setInlineEditId(lesson.id)
                        setInlineHours(lesson.hoursPerWeek)
                        inlineSavingRef.current = false
                      }}
                      className="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:underline rounded px-1 tabular-nums transition-colors"
                      title="Click to edit hours per week"
                    >
                      {lesson.hoursPerWeek}h/wk
                    </button>
                  )}
                </div>

                {/* Row actions */}
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openClone(lesson)}
                    title="Clone this lesson"
                  >
                    Clone
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(lesson)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeletingLesson(lesson)}
                    className="text-red-500 hover:text-red-600"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Floating bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl text-[12px] whitespace-nowrap"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
          }}
        >
          {/* Dismiss */}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
            title="Clear selection"
          >
            ✕
          </button>
          <span className="font-semibold text-[var(--text-1)]">{selectedIds.size} selected</span>

          <div className="w-px h-4 bg-[var(--border)]" />

          {/* Bulk h/wk */}
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-2)]">h/wk:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={bulkHours}
              onChange={e => setBulkHours(Number(e.target.value) || 1)}
              className="w-12 text-center text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-1)] focus:outline-none"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBulkHours}
              loading={bulkPending}
              disabled={bulkPending}
            >
              Set
            </Button>
          </div>

          <div className="w-px h-4 bg-[var(--border)]" />

          {/* Bulk teacher */}
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-2)]">Teacher:</span>
            <select
              className={FILTER_CLS}
              value={bulkTeacherId}
              onChange={e => setBulkTeacherId(e.target.value)}
              title={
                selectedSingleTeacherCount < selectedIds.size
                  ? `Only applies to ${selectedSingleTeacherCount} single-teacher lesson(s) in selection`
                  : undefined
              }
            >
              <option value="">Select…</option>
              {sortedTeachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBulkTeacher}
              loading={bulkPending}
              disabled={bulkPending || !bulkTeacherId || selectedSingleTeacherCount === 0}
              title={
                selectedSingleTeacherCount < selectedIds.size
                  ? `Applies to ${selectedSingleTeacherCount} of ${selectedIds.size} selected (Parallel/Multi-teacher types skipped)`
                  : undefined
              }
            >
              Set{selectedSingleTeacherCount < selectedIds.size ? ` (${selectedSingleTeacherCount})` : ''}
            </Button>
          </div>

          <div className="w-px h-4 bg-[var(--border)]" />

          {/* Bulk delete */}
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:text-red-600"
            onClick={() => setBulkConfirmDelete(true)}
            disabled={bulkPending}
          >
            🗑 Delete {selectedIds.size}
          </Button>

          {bulkError && (
            <span className="text-red-500 text-[11px] max-w-[200px] truncate">{bulkError}</span>
          )}
        </div>
      )}

      {/* ── Modals ── */}

      {/* Create / Clone */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setCreateError(undefined)
          setCloneError(undefined)
          setCloneSource(null)
        }}
        title={cloneSource ? 'Clone Lesson' : 'New Lesson'}
        width="max-w-xl"
      >
        <LessonForm
          key={cloneSource?.id ?? 'new'}
          onSave={handleCreate}
          onCancel={() => {
            setModalOpen(false)
            setCreateError(undefined)
            setCloneError(undefined)
            setCloneSource(null)
          }}
          loading={createLesson.isPending}
          error={cloneSource ? cloneError : createError}
          subjects={subjects}
          teachers={teachers}
          grades={grades}
          classes={classes}
          initialValues={cloneSource ? cloneInitialValues(cloneSource) : undefined}
        />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editingLesson}
        onClose={() => { setEditingLesson(null); setEditError(undefined) }}
        title="Edit Lesson"
        width="max-w-xl"
      >
        {editingLesson && (
          <LessonForm
            key={editingLesson.id}
            onSave={handleUpdate}
            onCancel={() => { setEditingLesson(null); setEditError(undefined) }}
            loading={updateLesson.isPending}
            error={editError}
            subjects={subjects}
            teachers={teachers}
            grades={grades}
            classes={classes}
            initialValues={cloneInitialValues(editingLesson)}
          />
        )}
      </Modal>

      {/* Single-row delete confirm */}
      <ConfirmDialog
        open={!!deletingLesson}
        onClose={() => { setDeletingLesson(null); setDeleteError(undefined) }}
        onConfirm={handleDelete}
        title="Delete lesson?"
        description="All schedule placements for this lesson will also be removed."
        confirmLabel="Delete Lesson"
        danger
        loading={deleteLesson.isPending}
        error={deleteError}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={bulkConfirmDelete}
        onClose={() => { setBulkConfirmDelete(false); setBulkDeleteError(undefined) }}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedIds.size} lessons?`}
        description="All schedule placements for these lessons will also be removed. This cannot be undone."
        confirmLabel={`Delete ${selectedIds.size} Lessons`}
        danger
        loading={bulkPending}
        error={bulkDeleteError}
      />
    </AppShell>
  )
}
