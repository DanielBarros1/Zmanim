/**
 * RestrictionsPage — manage scheduling constraints.
 *
 * Each restriction has:
 *   - type (from RestrictionType enum — 20 types across categories A/B/C/E)
 *   - tier (NON_NEGOTIABLE / IMPORTANT / PREFERRED / FLEXIBLE)
 *   - optional entity link (teacher, class, grade, lesson, subject)
 *   - type-specific params (day, slot, max, etc.)
 *   - optional note
 *   - isActive toggle (soft disable without deleting)
 *
 * The form is dynamic: fields change based on selected type.
 * All 20 restriction types are supported with their specific param fields.
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
  useRestrictions,
  useCreateRestriction,
  useUpdateRestriction,
  useDeleteRestriction,
} from '../../api/restrictions'
import { useTeachers } from '../../api/teachers'
import { useGrades, useClasses } from '../../api/grades'
import { useSubjects } from '../../api/subjects'
import { useLessons } from '../../api/lessons'
import {
  RestrictionType,
  RestrictionTier,
  RESTRICTION_TYPE_LABEL,
  TIER_LABEL,
  Day,
} from '@zmanim/shared'
import type { Restriction } from '@zmanim/shared'
import type { CreateRestrictionInput } from '../../api/restrictions'

const DAY_LABEL: Record<Day, string> = {
  [Day.SUNDAY]: 'Sunday',
  [Day.MONDAY]: 'Monday',
  [Day.TUESDAY]: 'Tuesday',
  [Day.WEDNESDAY]: 'Wednesday',
  [Day.THURSDAY]: 'Thursday',
}

// Category groupings for the type selector
const TYPE_CATEGORIES: Array<{ label: string; types: RestrictionType[] }> = [
  {
    label: 'Teacher — Availability',
    types: [
      RestrictionType.TEACHER_UNAVAILABLE_DAY,
      RestrictionType.TEACHER_UNAVAILABLE_SLOT,
      RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT,
    ],
  },
  {
    label: 'Teacher — Workload',
    types: [
      RestrictionType.TEACHER_MAX_DAYS_PER_WEEK,
      RestrictionType.TEACHER_MIN_DAYS_PER_WEEK,
      RestrictionType.TEACHER_MAX_LESSONS_PER_DAY,
      RestrictionType.TEACHER_MAX_CONSECUTIVE,
      RestrictionType.TEACHER_MAX_WINDOW,
      RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY,
    ],
  },
  {
    label: 'Class / Grade Quality',
    types: [
      RestrictionType.CLASS_NO_WINDOW,
      RestrictionType.CLASS_MINIMIZE_WINDOWS,
      RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY,
      RestrictionType.CLASS_ARTS_BALANCE,
      RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS,
    ],
  },
  {
    label: 'Room',
    types: [RestrictionType.ROOM_LARGE_FOR_SHARED],
  },
  {
    label: 'Lesson Preferences',
    types: [
      RestrictionType.LESSON_AVOID_DAY,
      RestrictionType.LESSON_AVOID_SLOT,
      RestrictionType.LESSON_PREFER_MORNING,
      RestrictionType.LESSON_PREFER_AFTERNOON,
      RestrictionType.LESSON_GRADE_SYNC,
    ],
  },
]

// Which types require a teacherId
const TEACHER_TYPES = new Set([
  RestrictionType.TEACHER_UNAVAILABLE_DAY,
  RestrictionType.TEACHER_UNAVAILABLE_SLOT,
  RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT,
  RestrictionType.TEACHER_MAX_DAYS_PER_WEEK,
  RestrictionType.TEACHER_MIN_DAYS_PER_WEEK,
  RestrictionType.TEACHER_MAX_LESSONS_PER_DAY,
  RestrictionType.TEACHER_MAX_CONSECUTIVE,
  RestrictionType.TEACHER_MAX_WINDOW,
  RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY,
])

const CLASS_TYPES = new Set([
  RestrictionType.CLASS_NO_WINDOW,
  RestrictionType.CLASS_MINIMIZE_WINDOWS,
  RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY,
  RestrictionType.CLASS_ARTS_BALANCE,
  RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS,
])

const LESSON_TYPES_SET = new Set([
  RestrictionType.LESSON_AVOID_DAY,
  RestrictionType.LESSON_AVOID_SLOT,
  RestrictionType.LESSON_PREFER_MORNING,
  RestrictionType.LESSON_PREFER_AFTERNOON,
  RestrictionType.LESSON_GRADE_SYNC,
])

// Default tier per type
const DEFAULT_TIER: Partial<Record<RestrictionType, RestrictionTier>> = {
  [RestrictionType.TEACHER_UNAVAILABLE_DAY]: RestrictionTier.NON_NEGOTIABLE,
  [RestrictionType.TEACHER_UNAVAILABLE_SLOT]: RestrictionTier.NON_NEGOTIABLE,
  [RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT]: RestrictionTier.NON_NEGOTIABLE,
  [RestrictionType.TEACHER_MIN_DAYS_PER_WEEK]: RestrictionTier.NON_NEGOTIABLE,
  [RestrictionType.CLASS_NO_WINDOW]: RestrictionTier.NON_NEGOTIABLE,
  [RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY]: RestrictionTier.IMPORTANT,
  [RestrictionType.CLASS_ARTS_BALANCE]: RestrictionTier.IMPORTANT,
  [RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS]: RestrictionTier.IMPORTANT,
  [RestrictionType.CLASS_MINIMIZE_WINDOWS]: RestrictionTier.PREFERRED,
  [RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY]: RestrictionTier.FLEXIBLE,
  [RestrictionType.LESSON_PREFER_MORNING]: RestrictionTier.PREFERRED,
  [RestrictionType.LESSON_PREFER_AFTERNOON]: RestrictionTier.PREFERRED,
  [RestrictionType.LESSON_GRADE_SYNC]: RestrictionTier.NON_NEGOTIABLE,
}

// ── Param fields component ───────────────────────────────────────

function ParamFields({
  type,
  params,
  onChange,
  slots,
}: {
  type: RestrictionType
  params: Record<string, unknown>
  onChange: (p: Record<string, unknown>) => void
  slots: number
}) {
  const set = (key: string, value: unknown) => onChange({ ...params, [key]: value })

  switch (type) {
    case RestrictionType.TEACHER_UNAVAILABLE_DAY:
    case RestrictionType.LESSON_AVOID_DAY:
      return (
        <Select
          label="Day"
          value={(params.day as string) ?? ''}
          onChange={e => set('day', e.target.value)}
        >
          <option value="">Select day…</option>
          {Object.values(Day).map(d => (
            <option key={d} value={d}>{DAY_LABEL[d]}</option>
          ))}
        </Select>
      )

    case RestrictionType.TEACHER_UNAVAILABLE_SLOT:
    case RestrictionType.LESSON_AVOID_SLOT:
      return (
        <Select
          label="Slot"
          value={(params.slot as number) ?? ''}
          onChange={e => set('slot', Number(e.target.value))}
        >
          <option value="">Select slot…</option>
          {Array.from({ length: slots }, (_, i) => i + 1).map(s => (
            <option key={s} value={s}>Slot {s}</option>
          ))}
        </Select>
      )

    case RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT:
      return (
        <div className="space-y-3">
          <Select
            label="Day"
            value={(params.day as string) ?? ''}
            onChange={e => set('day', e.target.value)}
          >
            <option value="">Select day…</option>
            {Object.values(Day).map(d => (
              <option key={d} value={d}>{DAY_LABEL[d]}</option>
            ))}
          </Select>
          <Select
            label="Slot"
            value={(params.slot as number) ?? ''}
            onChange={e => set('slot', Number(e.target.value))}
          >
            <option value="">Select slot…</option>
            {Array.from({ length: slots }, (_, i) => i + 1).map(s => (
              <option key={s} value={s}>Slot {s}</option>
            ))}
          </Select>
        </div>
      )

    case RestrictionType.TEACHER_MAX_DAYS_PER_WEEK:
      return (
        <Input
          label="Max days per week"
          type="number"
          min={1}
          max={5}
          value={(params.max as number) ?? 3}
          onChange={e => set('max', Number(e.target.value))}
          className="w-28"
        />
      )

    case RestrictionType.TEACHER_MIN_DAYS_PER_WEEK:
      return (
        <Input
          label="Min days per week"
          type="number"
          min={1}
          max={5}
          value={(params.min as number) ?? 2}
          onChange={e => set('min', Number(e.target.value))}
          className="w-28"
        />
      )

    case RestrictionType.TEACHER_MAX_LESSONS_PER_DAY:
      return (
        <Input
          label="Max lessons per day"
          type="number"
          min={1}
          max={slots}
          value={(params.max as number) ?? 3}
          onChange={e => set('max', Number(e.target.value))}
          className="w-28"
        />
      )

    case RestrictionType.TEACHER_MAX_CONSECUTIVE:
      return (
        <Input
          label="Max consecutive lessons"
          type="number"
          min={1}
          max={slots}
          value={(params.max as number) ?? 2}
          onChange={e => set('max', Number(e.target.value))}
          className="w-28"
        />
      )

    case RestrictionType.TEACHER_MAX_WINDOW:
      return (
        <Input
          label="Max free slots in a day"
          type="number"
          min={0}
          max={slots - 1}
          value={(params.maxSlots as number) ?? 1}
          onChange={e => set('maxSlots', Number(e.target.value))}
          className="w-28"
        />
      )

    case RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS:
      return (
        <Input
          label="Max days with edge placement"
          type="number"
          min={1}
          max={5}
          value={(params.maxDays as number) ?? 2}
          onChange={e => set('maxDays', Number(e.target.value))}
          className="w-28"
        />
      )

    // No extra params needed:
    case RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY:
    case RestrictionType.CLASS_NO_WINDOW:
    case RestrictionType.CLASS_MINIMIZE_WINDOWS:
    case RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY:
    case RestrictionType.CLASS_ARTS_BALANCE:
    case RestrictionType.ROOM_LARGE_FOR_SHARED:
    case RestrictionType.LESSON_PREFER_MORNING:
    case RestrictionType.LESSON_PREFER_AFTERNOON:
    case RestrictionType.LESSON_GRADE_SYNC:
      return (
        <p className="text-[12px] text-[var(--text-3)]">
          No additional parameters needed.
        </p>
      )

    default:
      return null
  }
}

// ── Restriction Form ─────────────────────────────────────────────

function RestrictionForm({
  onSave,
  onCancel,
  loading,
}: {
  onSave: (data: CreateRestrictionInput) => void
  onCancel: () => void
  loading: boolean
}) {
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const { data: lessons = [] } = useLessons()

  const [type, setType] = useState<RestrictionType>(
    RestrictionType.TEACHER_UNAVAILABLE_DAY,
  )
  const [tier, setTier] = useState<RestrictionTier>(RestrictionTier.NON_NEGOTIABLE)
  const [teacherId, setTeacherId] = useState('')
  const [classId, setClassId] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [lessonId, setLessonId] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [note, setNote] = useState('')

  const handleTypeChange = (newType: RestrictionType) => {
    setType(newType)
    setParams({})
    // Set sensible default tier
    const defaultTier = DEFAULT_TIER[newType]
    if (defaultTier) setTier(defaultTier)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      type,
      tier,
      teacherId: teacherId || undefined,
      classId: classId || undefined,
      gradeId: gradeId || undefined,
      subjectId: subjectId || undefined,
      lessonId: lessonId || undefined,
      params,
      note: note || undefined,
    })
  }

  // Grade → classes options
  const classOptions = grades.flatMap(g =>
    classes
      .filter(c => c.gradeId === g.id)
      .map(c => ({ value: c.id, label: `Grade ${g.number}${c.section}` })),
  )

  const needsTeacher = TEACHER_TYPES.has(type)
  const needsClass = CLASS_TYPES.has(type)
  const needsLesson = LESSON_TYPES_SET.has(type)

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type selector — grouped */}
      <div>
        <label className="text-[12px] font-medium text-[var(--text-2)]">
          Restriction type
        </label>
        <select
          className="mt-1 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-1)] focus:outline-none focus:border-[var(--accent)]"
          value={type}
          onChange={e => handleTypeChange(e.target.value as RestrictionType)}
        >
          {TYPE_CATEGORIES.map(cat => (
            <optgroup key={cat.label} label={cat.label}>
              {cat.types.map(t => (
                <option key={t} value={t}>
                  {RESTRICTION_TYPE_LABEL[t]
                    .replace(/\{[^}]+\}/g, '…')
                    .slice(0, 60)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Tier */}
      <Select
        label="Priority tier"
        value={tier}
        onChange={e => setTier(e.target.value as RestrictionTier)}
      >
        {Object.values(RestrictionTier).map(t => (
          <option key={t} value={t}>{TIER_LABEL[t]}</option>
        ))}
      </Select>

      {/* Entity selectors */}
      {needsTeacher && (
        <Select
          label="Teacher"
          value={teacherId}
          onChange={e => setTeacherId(e.target.value)}
          required
        >
          <option value="">Select teacher…</option>
          {teachers.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      )}

      {needsClass && (
        <Select
          label="Class"
          value={classId}
          onChange={e => setClassId(e.target.value)}
          required
        >
          <option value="">Select class…</option>
          {classOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      )}

      {needsLesson && (
        <div className="space-y-2">
          <Select
            label="Subject (optional filter)"
            value={subjectId}
            onChange={e => { setSubjectId(e.target.value); setLessonId('') }}
          >
            <option value="">Any subject</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Select
            label="Lesson"
            value={lessonId}
            onChange={e => setLessonId(e.target.value)}
          >
            <option value="">All lessons (applies globally)</option>
            {lessons
              .filter(l => !subjectId || l.subjectId === subjectId)
              .map(l => {
                const sub = subjects.find(s => s.id === l.subjectId)
                return (
                  <option key={l.id} value={l.id}>
                    {sub?.name ?? l.id} — {l.hoursPerWeek}h/wk
                  </option>
                )
              })}
          </Select>
        </div>
      )}

      {/* Type-specific params */}
      <div
        className="p-4 rounded-lg"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] mb-3">
          Parameters
        </p>
        <ParamFields
          type={type}
          params={params}
          onChange={setParams}
          slots={4}
        />
      </div>

      {/* Note */}
      <Input
        label="Note (optional)"
        placeholder="Reason for this restriction…"
        value={note}
        onChange={e => setNote(e.target.value)}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Save Restriction
        </Button>
      </div>
    </form>
  )
}

// ── Tier badge colors ────────────────────────────────────────────

const TIER_BADGE: Record<RestrictionTier, 'warn' | 'accent' | 'neutral' | 'ok'> = {
  [RestrictionTier.NON_NEGOTIABLE]: 'warn',
  [RestrictionTier.IMPORTANT]: 'accent',
  [RestrictionTier.PREFERRED]: 'ok',
  [RestrictionTier.FLEXIBLE]: 'neutral',
}

// ── Page ────────────────────────────────────────────────────────

export function RestrictionsPage() {
  const { data: restrictions = [], isLoading } = useRestrictions()
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const createRestriction = useCreateRestriction()
  const updateRestriction = useUpdateRestriction()
  const deleteRestriction = useDeleteRestriction()

  const [modalOpen, setModalOpen] = useState(false)
  const [deletingRestriction, setDeletingRestriction] = useState<Restriction | null>(null)
  const [tierFilter, setTierFilter] = useState<RestrictionTier | 'ALL'>('ALL')

  const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]))
  const classMap = Object.fromEntries(classes.map(c => [c.id, c]))
  const gradeMap = Object.fromEntries(grades.map(g => [g.id, g]))
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))

  const handleCreate = async (data: CreateRestrictionInput) => {
    await createRestriction.mutateAsync(data)
    setModalOpen(false)
  }

  const handleDelete = async () => {
    if (!deletingRestriction) return
    await deleteRestriction.mutateAsync(deletingRestriction.id)
    setDeletingRestriction(null)
  }

  const toggleActive = async (r: Restriction) => {
    await updateRestriction.mutateAsync({
      id: r.id,
      data: { isActive: !r.isActive },
    })
  }

  const filtered = tierFilter === 'ALL'
    ? restrictions
    : restrictions.filter(r => r.tier === tierFilter)

  /** Render entity context for a restriction row */
  function entityContext(r: Restriction): string {
    const parts: string[] = []
    if (r.teacherId && teacherMap[r.teacherId]) parts.push(teacherMap[r.teacherId].name)
    if (r.classId && classMap[r.classId]) {
      const cls = classMap[r.classId]
      const grade = gradeMap[cls.gradeId]
      parts.push(`Grade ${grade?.number ?? '?'}${cls.section}`)
    }
    if (r.subjectId && subjectMap[r.subjectId]) parts.push(subjectMap[r.subjectId].name)
    return parts.join(' · ')
  }

  if (isLoading) {
    return (
      <AppShell title="Restrictions">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Restrictions"
      actions={<Button onClick={() => setModalOpen(true)}>+ New Restriction</Button>}
    >
      {/* Tier filter */}
      <div className="flex gap-1 mb-4">
        {(['ALL', ...Object.values(RestrictionTier)] as const).map(t => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className={[
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              tierFilter === t
                ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]',
            ].join(' ')}
          >
            {t === 'ALL'
              ? `All (${restrictions.length})`
              : `${TIER_LABEL[t as RestrictionTier]} (${restrictions.filter(r => r.tier === t).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔒"
          title="No restrictions yet"
          description="Add constraints to guide the auto-scheduler and validate manual placements."
          action={<Button onClick={() => setModalOpen(true)}>+ New Restriction</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <div
              key={r.id}
              className={[
                'flex items-center gap-4 px-4 py-3 rounded-lg border transition-opacity',
                !r.isActive ? 'opacity-50' : '',
              ].join(' ')}
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <Badge variant={TIER_BADGE[r.tier]}>{TIER_LABEL[r.tier]}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-1)] truncate">
                  {RESTRICTION_TYPE_LABEL[r.type].replace(/\{[^}]+\}/g, '…')}
                </p>
                {entityContext(r) && (
                  <p className="text-[11px] text-[var(--text-3)] hebrew">{entityContext(r)}</p>
                )}
                {r.note && (
                  <p className="text-[11px] text-[var(--text-3)] mt-0.5 italic">{r.note}</p>
                )}
              </div>
              {!r.isActive && (
                <Badge variant="neutral">Disabled</Badge>
              )}
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive(r)}
                  title={r.isActive ? 'Disable' : 'Enable'}
                >
                  {r.isActive ? '⏸' : '▶'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingRestriction(r)}
                  className="text-red-500 hover:text-red-600"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Restriction"
        width="max-w-xl"
      >
        <RestrictionForm
          onSave={handleCreate}
          onCancel={() => setModalOpen(false)}
          loading={createRestriction.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deletingRestriction}
        onClose={() => setDeletingRestriction(null)}
        onConfirm={handleDelete}
        title="Delete restriction?"
        description="Existing overrides for this restriction will also be removed."
        confirmLabel="Delete"
        danger
        loading={deleteRestriction.isPending}
      />
    </AppShell>
  )
}
