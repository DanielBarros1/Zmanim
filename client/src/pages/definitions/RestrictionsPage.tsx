/**
 * RestrictionsPage — manage scheduling constraints.
 *
 * Three tabs:
 *   Teachers        — per-teacher availability & workload (most frequently edited)
 *   Classes & Lessons — class quality rules + lesson placement preferences
 *   System          — global room / infrastructure rules
 *
 * The form is context-aware: opening it from a teacher card pre-selects that
 * teacher and filters the type list to teacher-only types. Opening it from
 * the Classes & Lessons tab filters to those types, etc.
 *
 * Restriction labels fully resolve param values (day names, slot numbers,
 * numeric limits) rather than showing "…" for everything.
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
import { useConfig, useUpdateConfig } from '../../api/config'
import { useTeachers } from '../../api/teachers'
import { useGrades, useClasses } from '../../api/grades'
import { useSubjects } from '../../api/subjects'
import { useLessons } from '../../api/lessons'
import { TeacherAvailabilityModal } from '../../components/schedule/TeacherAvailabilityModal'
import type { AvailabilityCell } from '../../components/schedule/TeacherAvailabilityModal'
import {
  RestrictionType,
  RestrictionTier,
  RESTRICTION_TYPE_LABEL,
  TIER_LABEL,
  Day,
} from '@zmanim/shared'
import type { Restriction, Teacher, Class, Grade, Subject, Lesson } from '@zmanim/shared'
import type { CreateRestrictionInput } from '../../api/restrictions'

// ── Display helpers ──────────────────────────────────────────────

const DAY_LABEL: Record<Day, string> = {
  [Day.SUNDAY]: 'Sunday',
  [Day.MONDAY]: 'Monday',
  [Day.TUESDAY]: 'Tuesday',
  [Day.WEDNESDAY]: 'Wednesday',
  [Day.THURSDAY]: 'Thursday',
}

/** Compact labels for teacher restriction cards — strips the teacher subject prefix */
const COMPACT_LABEL: Partial<Record<RestrictionType, string>> = {
  [RestrictionType.TEACHER_UNAVAILABLE_DAY]: 'Unavailable · {day}',
  [RestrictionType.TEACHER_UNAVAILABLE_SLOT]: 'Unavailable · slot {slot}',
  [RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT]: 'Unavailable · {day} slot {slot}',
  [RestrictionType.TEACHER_MAX_DAYS_PER_WEEK]: 'Max {max} days / week',
  [RestrictionType.TEACHER_MIN_DAYS_PER_WEEK]: 'Min {min} days / week',
  [RestrictionType.TEACHER_MAX_LESSONS_PER_DAY]: 'Max {max} lessons / day',
  [RestrictionType.TEACHER_MAX_CONSECUTIVE]: 'Max {max} consecutive',
  [RestrictionType.TEACHER_MAX_WINDOW]: 'Max {maxSlots} free slots / day',
  [RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY]: 'No single-lesson days',
}

interface EntityMaps {
  classMap: Record<string, Class>
  gradeMap: Record<string, Grade>
  subjectMap: Record<string, Subject>
  lessonMap: Record<string, Lesson>
  teacherMap: Record<string, Teacher>
}

/**
 * Resolves a restriction label, substituting actual param values and entity names.
 * Pass compact=true inside teacher cards to use the shorter COMPACT_LABEL template.
 */
function resolveLabel(r: Restriction, maps: Partial<EntityMaps> = {}, compact = false): string {
  const {
    classMap = {}, gradeMap = {}, subjectMap = {},
    lessonMap = {}, teacherMap = {},
  } = maps
  const p = r.params as any
  const template = compact
    ? (COMPACT_LABEL[r.type] ?? RESTRICTION_TYPE_LABEL[r.type])
    : RESTRICTION_TYPE_LABEL[r.type]

  // Resolve entity names
  const teacherName = r.teacherId && teacherMap[r.teacherId] ? teacherMap[r.teacherId].name : '?'

  let className = '?'
  if (r.classId && classMap[r.classId]) {
    const cls = classMap[r.classId]
    const grade = gradeMap[cls.gradeId]
    className = grade ? `${grade.number}${cls.section}` : cls.section
  }

  const subjectName = r.subjectId && subjectMap[r.subjectId] ? subjectMap[r.subjectId].name : '?'

  let lessonDesc = '?'
  if (r.lessonId && lessonMap[r.lessonId]) {
    const lesson = lessonMap[r.lessonId]
    const sub = subjectMap[lesson.subjectId]
    lessonDesc = sub ? sub.name : '?'
  }

  return template
    .replace('{teacher}', teacherName)
    .replace('{class}', className)
    .replace('{subject}', subjectName)
    .replace('{lesson}', lessonDesc)
    .replace('{grade}', '?')
    .replace('{day}', p.day ? DAY_LABEL[p.day as Day] : '?')
    .replace('{slot}', p.slot != null ? String(p.slot) : '?')
    .replace('{max}', p.max != null ? String(p.max) : '?')
    .replace('{min}', p.min != null ? String(p.min) : '?')
    .replace('{maxSlots}', p.maxSlots != null ? String(p.maxSlots) : '?')
    .replace('{maxDays}', p.maxDays != null ? String(p.maxDays) : '?')
    .replace(/\{[^}]+\}/g, '?')
}

// ── Tab type ─────────────────────────────────────────────────────

type Tab = 'teachers' | 'classes-lessons' | 'system'

// ── Type groupings ───────────────────────────────────────────────

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

const ALLOWED_TYPES_BY_TAB: Record<Tab, RestrictionType[]> = {
  teachers: Array.from(TEACHER_TYPES),
  'classes-lessons': [...Array.from(CLASS_TYPES), ...Array.from(LESSON_TYPES_SET)],
  system: [RestrictionType.ROOM_LARGE_FOR_SHARED],
}

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

// Tiers available for user-configured restrictions.
// INVARIANT is intentionally excluded — it is reserved for hard physical
// constraints generated by the evaluator and can never be user-assigned.
const USER_TIERS = Object.values(RestrictionTier).filter(
  t => t !== RestrictionTier.INVARIANT,
)

// Tier visual indicators
const TIER_DOT: Record<RestrictionTier, string> = {
  [RestrictionTier.INVARIANT]:      '#b91c1c',   // never shown in the dropdown but satisfies the Record type
  [RestrictionTier.NON_NEGOTIABLE]: '#ef4444',
  [RestrictionTier.IMPORTANT]:      '#f59e0b',
  [RestrictionTier.PREFERRED]:      '#22c55e',
  [RestrictionTier.FLEXIBLE]:       '#94a3b8',
}

const TIER_BADGE: Record<RestrictionTier, 'warn' | 'accent' | 'neutral' | 'ok'> = {
  [RestrictionTier.INVARIANT]:      'warn',
  [RestrictionTier.NON_NEGOTIABLE]: 'warn',
  [RestrictionTier.IMPORTANT]: 'accent',
  [RestrictionTier.PREFERRED]: 'ok',
  [RestrictionTier.FLEXIBLE]: 'neutral',
}

// ── Param fields component ───────────────────────────────────────

function ParamFields({
  type, params, onChange, slots,
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
        <Select label="Day" value={(params.day as string) ?? ''} onChange={e => set('day', e.target.value)}>
          <option value="">Select day…</option>
          {Object.values(Day).map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
        </Select>
      )

    case RestrictionType.TEACHER_UNAVAILABLE_SLOT:
    case RestrictionType.LESSON_AVOID_SLOT:
      return (
        <Select label="Slot" value={(params.slot as number) ?? ''} onChange={e => set('slot', Number(e.target.value))}>
          <option value="">Select slot…</option>
          {Array.from({ length: slots }, (_, i) => i + 1).map(s => <option key={s} value={s}>Slot {s}</option>)}
        </Select>
      )

    case RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT:
      return (
        <div className="space-y-3">
          <Select label="Day" value={(params.day as string) ?? ''} onChange={e => set('day', e.target.value)}>
            <option value="">Select day…</option>
            {Object.values(Day).map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
          </Select>
          <Select label="Slot" value={(params.slot as number) ?? ''} onChange={e => set('slot', Number(e.target.value))}>
            <option value="">Select slot…</option>
            {Array.from({ length: slots }, (_, i) => i + 1).map(s => <option key={s} value={s}>Slot {s}</option>)}
          </Select>
        </div>
      )

    case RestrictionType.TEACHER_MAX_DAYS_PER_WEEK:
      return <Input label="Max days per week" type="number" min={1} max={5} value={(params.max as number) ?? 3} onChange={e => set('max', Number(e.target.value))} className="w-28" />

    case RestrictionType.TEACHER_MIN_DAYS_PER_WEEK:
      return <Input label="Min days per week" type="number" min={1} max={5} value={(params.min as number) ?? 2} onChange={e => set('min', Number(e.target.value))} className="w-28" />

    case RestrictionType.TEACHER_MAX_LESSONS_PER_DAY:
      return <Input label="Max lessons per day" type="number" min={1} max={slots} value={(params.max as number) ?? 3} onChange={e => set('max', Number(e.target.value))} className="w-28" />

    case RestrictionType.TEACHER_MAX_CONSECUTIVE:
      return <Input label="Max consecutive lessons" type="number" min={1} max={slots} value={(params.max as number) ?? 2} onChange={e => set('max', Number(e.target.value))} className="w-28" />

    case RestrictionType.TEACHER_MAX_WINDOW:
      return <Input label="Max free slots in a day" type="number" min={0} max={slots - 1} value={(params.maxSlots as number) ?? 1} onChange={e => set('maxSlots', Number(e.target.value))} className="w-28" />

    case RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS:
      return <Input label="Max days with edge placement" type="number" min={1} max={5} value={(params.maxDays as number) ?? 2} onChange={e => set('maxDays', Number(e.target.value))} className="w-28" />

    case RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY:
    case RestrictionType.CLASS_NO_WINDOW:
    case RestrictionType.CLASS_MINIMIZE_WINDOWS:
    case RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY:
    case RestrictionType.CLASS_ARTS_BALANCE:
    case RestrictionType.ROOM_LARGE_FOR_SHARED:
    case RestrictionType.LESSON_PREFER_MORNING:
    case RestrictionType.LESSON_PREFER_AFTERNOON:
    case RestrictionType.LESSON_GRADE_SYNC:
      return <p className="text-[12px] text-[var(--text-3)]">No additional parameters needed.</p>

    default:
      return null
  }
}

// ── Restriction form ─────────────────────────────────────────────

function RestrictionForm({
  onSave, onSaveAndAdd, onCancel, loading, error,
  preselectedTeacherId, allowedTypes,
}: {
  onSave: (data: CreateRestrictionInput) => void
  /** Optional: save and keep modal open for another entry. Only shown in teacher context. */
  onSaveAndAdd?: (data: CreateRestrictionInput) => void
  onCancel: () => void
  loading: boolean
  error?: string
  /** Pre-fills + locks the teacher selector when opening from a teacher card */
  preselectedTeacherId?: string
  /** Limits the type dropdown to types relevant to the current tab */
  allowedTypes?: RestrictionType[]
}) {
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const { data: lessons = [] } = useLessons()
  const { data: config } = useConfig()

  const defaultType = allowedTypes?.[0] ?? RestrictionType.TEACHER_UNAVAILABLE_DAY

  const [type, setType] = useState<RestrictionType>(defaultType)
  const [tier, setTier] = useState<RestrictionTier>(DEFAULT_TIER[defaultType] ?? RestrictionTier.NON_NEGOTIABLE)
  const [teacherId, setTeacherId] = useState(preselectedTeacherId ?? '')
  const [classId, setClassId] = useState('')
  const [gradeId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [lessonId, setLessonId] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [note, setNote] = useState('')

  const handleTypeChange = (newType: RestrictionType) => {
    setType(newType)
    setParams({})
    setTier(DEFAULT_TIER[newType] ?? RestrictionTier.NON_NEGOTIABLE)
  }

  const buildPayload = (): CreateRestrictionInput => ({
    type, tier,
    teacherId: teacherId || undefined,
    classId: classId || undefined,
    gradeId: gradeId || undefined,
    subjectId: subjectId || undefined,
    lessonId: lessonId || undefined,
    params,
    note: note || undefined,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(buildPayload())
  }

  const handleSaveAndAdd = (e: React.MouseEvent) => {
    e.preventDefault()
    onSaveAndAdd?.(buildPayload())
  }

  const classOptions = grades.flatMap(g =>
    classes.filter(c => c.gradeId === g.id).map(c => ({
      value: c.id,
      label: `Grade ${g.number}${c.section}`,
    }))
  )

  const needsTeacher = TEACHER_TYPES.has(type)
  const needsClass = CLASS_TYPES.has(type)
  const needsLesson = LESSON_TYPES_SET.has(type)

  // Filter categories to only allowed types
  const visibleCategories = allowedTypes
    ? TYPE_CATEGORIES
        .map(cat => ({ ...cat, types: cat.types.filter(t => allowedTypes.includes(t)) }))
        .filter(cat => cat.types.length > 0)
    : TYPE_CATEGORIES

  const lockedTeacher = preselectedTeacherId
    ? teachers.find(t => t.id === preselectedTeacherId)
    : undefined

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type selector */}
      <div>
        <label className="text-[12px] font-medium text-[var(--text-2)]">Restriction type</label>
        <select
          className="mt-1 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-1)] focus:outline-none focus:border-[var(--accent)]"
          value={type}
          onChange={e => handleTypeChange(e.target.value as RestrictionType)}
        >
          {visibleCategories.map(cat => (
            <optgroup key={cat.label} label={cat.label}>
              {cat.types.map(t => (
                <option key={t} value={t}>
                  {RESTRICTION_TYPE_LABEL[t].replace(/\{[^}]+\}/g, '…').slice(0, 60)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Tier */}
      <Select label="Priority tier" value={tier} onChange={e => setTier(e.target.value as RestrictionTier)}>
        {USER_TIERS.map(t => (
          <option key={t} value={t}>{TIER_LABEL[t]}</option>
        ))}
      </Select>

      {/* Teacher — locked when opened from a teacher card */}
      {needsTeacher && (
        lockedTeacher ? (
          <div>
            <label className="text-[12px] font-medium text-[var(--text-2)]">Teacher</label>
            <p
              className="mt-1 px-3 py-2 rounded-md text-[13px] text-[var(--text-1)] hebrew"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {lockedTeacher.name}
            </p>
          </div>
        ) : (
          <Select label="Teacher" value={teacherId} onChange={e => setTeacherId(e.target.value)} required>
            <option value="">Select teacher…</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )
      )}

      {/* Class */}
      {needsClass && (
        <Select label="Class" value={classId} onChange={e => setClassId(e.target.value)} required>
          <option value="">Select class…</option>
          {classOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}

      {/* Lesson */}
      {needsLesson && (
        <div className="space-y-2">
          <Select
            label="Subject (optional filter)"
            value={subjectId}
            onChange={e => { setSubjectId(e.target.value); setLessonId('') }}
          >
            <option value="">Any subject</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label="Lesson" value={lessonId} onChange={e => setLessonId(e.target.value)}>
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
      <div className="p-4 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] mb-3">
          Parameters
        </p>
        <ParamFields type={type} params={params} onChange={setParams} slots={config?.slotsPerDay ?? 4} />
      </div>

      {/* Note */}
      <Input
        label="Note (optional)"
        placeholder="Reason for this restriction…"
        value={note}
        onChange={e => setNote(e.target.value)}
      />

      {error && (
        <p className="text-[12px] text-red-500 rounded-md px-3 py-2" style={{ background: 'var(--warn-bg)' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        {onSaveAndAdd && (
          <Button
            type="button"
            variant="secondary"
            loading={loading}
            onClick={handleSaveAndAdd}
          >
            Save &amp; Add Another
          </Button>
        )}
        <Button type="submit" loading={loading}>Save Restriction</Button>
      </div>
    </form>
  )
}

// ── Hard invariants panel — read-only, except D7 which has subject exemptions ──

const HARD_INVARIANTS = [
  { id: 'D1', type: 'TEACHER_DOUBLE_BOOKED',           tier: 'INVARIANT',      label: 'Teacher double-booked',               description: 'A teacher cannot be scheduled in two places at the same time slot.' },
  { id: 'D2', type: 'CLASS_DOUBLE_BOOKED',              tier: 'INVARIANT',      label: 'Class double-booked',                 description: 'A class cannot have two lessons at the same time slot.' },
  { id: 'D3', type: 'MATH_GROUPS_NOT_SIMULTANEOUS',    tier: 'INVARIANT',      label: 'Math groups must be simultaneous',    description: 'All math level groups for the same grade must share the same time slots.' },
  { id: 'D4', type: 'ENGLISH_GROUPS_NOT_SIMULTANEOUS', tier: 'INVARIANT',      label: 'English groups must be simultaneous', description: 'All English level groups for the same grade must share the same time slots.' },
  { id: 'D5', type: 'ROOM_CONFLICT',                    tier: 'INVARIANT',      label: 'Room conflict',                       description: 'Two lessons cannot occupy the same room at the same time.' },
  { id: 'D6', type: 'SPECIALIZED_ROOM_VIOLATED',        tier: 'NON_NEGOTIABLE', label: 'Specialized room not used',           description: 'A subject with a designated specialized room should be taught there. Can be fixed manually via the room badge.' },
  { id: 'D7', type: 'CLASS_SUBJECT_TWICE_PER_DAY',     tier: 'INVARIANT',      label: 'Same subject twice in one day',       description: 'A class cannot have the same subject at two different time slots on the same day. Exceptions can be configured below.' },
]

/**
 * D7 exception editor — subject checklist.
 * Subjects checked here are exempt from the "no subject twice per day" hard invariant.
 */
function D7ExceptionEditor({
  subjects,
  exemptIds,
  onChange,
  saving,
}: {
  subjects: Subject[]
  exemptIds: string[]
  onChange: (ids: string[]) => void
  saving: boolean
}) {
  const sortedSubjects = [...subjects].sort((a, b) => a.name.localeCompare(b.name, 'he'))
  const exemptSet = new Set(exemptIds)

  const toggle = (id: string) => {
    if (exemptSet.has(id)) {
      onChange(exemptIds.filter(x => x !== id))
    } else {
      onChange([...exemptIds, id])
    }
  }

  return (
    <div
      className="mt-3 pt-3 border-t"
      style={{ borderColor: 'var(--border)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">
        Allowed twice per day
      </p>
      <p className="text-[11px] text-[var(--text-2)] mb-3">
        Subjects checked below may appear at two different slots on the same day. All others still trigger a violation.
      </p>
      {sortedSubjects.length === 0 ? (
        <p className="text-[11px] text-[var(--text-3)] italic">No subjects defined yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sortedSubjects.map(s => {
            const checked = exemptSet.has(s.id)
            return (
              <label
                key={s.id}
                className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1.5 rounded-lg border text-[12px] select-none transition-colors hebrew"
                style={{
                  background: checked ? s.color + '22' : 'var(--surface)',
                  borderColor: checked ? s.color : 'var(--border)',
                  color: checked ? 'var(--text-1)' : 'var(--text-2)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                  className="w-3 h-3 accent-[var(--accent)]"
                  disabled={saving}
                />
                {s.name}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HardInvariantsPanel({ subjects }: { subjects: Subject[] }) {
  const [open, setOpen] = useState(false)
  const { data: config } = useConfig()
  const updateConfig = useUpdateConfig()

  // Local draft of exempt IDs — synced from server config, editable locally
  const [exemptIds, setExemptIds] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  // Sync from server when config loads
  const serverExemptIds = config?.subjectTwicePerDayAllowed ?? []
  // Only reset local state when opening the panel or when server value changes externally
  const serverKey = serverExemptIds.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableServerKey = serverKey
  const [lastSyncedKey, setLastSyncedKey] = useState('')
  if (stableServerKey !== lastSyncedKey && !dirty) {
    setExemptIds(serverExemptIds)
    setLastSyncedKey(stableServerKey)
  }

  const handleChange = (ids: string[]) => {
    setExemptIds(ids)
    setDirty(true)
    setSaveError(undefined)
  }

  const handleSave = async () => {
    setSaveError(undefined)
    try {
      await updateConfig.mutateAsync({ subjectTwicePerDayAllowed: exemptIds } as any)
      setDirty(false)
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? 'Failed to save.')
    }
  }

  return (
    <div
      className="mb-4 rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            🔒 Built-in Hard Constraints
          </span>
          <span className="ml-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
            Always enforced — D7 has configurable exceptions
          </span>
        </div>
        <span className="text-[var(--text-3)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          {HARD_INVARIANTS.map(inv => (
            <div
              key={inv.id}
              className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <span
                className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5"
                style={{
                  background: inv.tier === 'INVARIANT' ? '#FEE2E2' : '#FEF3C7',
                  color:      inv.tier === 'INVARIANT' ? '#991B1B' : '#92400E',
                }}
              >
                {inv.tier === 'INVARIANT' ? '⛔ INVARIANT' : '⚠ NON-NEG.'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {inv.id}: {inv.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                  {inv.description}
                </p>

                {/* D7 — inline subject exception editor */}
                {inv.id === 'D7' && (
                  <>
                    <D7ExceptionEditor
                      subjects={subjects}
                      exemptIds={exemptIds}
                      onChange={handleChange}
                      saving={updateConfig.isPending}
                    />
                    {(dirty || saveError) && (
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleSave}
                          loading={updateConfig.isPending}
                        >
                          Save exceptions
                        </Button>
                        {saveError && (
                          <span className="text-[11px] text-red-500">{saveError}</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Teachers tab — teacher-first card layout ─────────────────────

function TeachersTab({
  teachers, restrictions, maps, onAdd, onAvailability, onToggle, onDelete,
}: {
  teachers: Teacher[]
  restrictions: Restriction[]
  maps: EntityMaps
  onAdd: (teacherId: string) => void
  onAvailability: (teacherId: string) => void
  onToggle: (r: Restriction) => void
  onDelete: (r: Restriction) => void
}) {
  // Group restrictions by teacher
  const byTeacher = new Map<string, Restriction[]>()
  for (const r of restrictions) {
    if (!r.teacherId) continue
    if (!byTeacher.has(r.teacherId)) byTeacher.set(r.teacherId, [])
    byTeacher.get(r.teacherId)!.push(r)
  }

  if (teachers.length === 0) {
    return (
      <EmptyState
        icon="👩‍🏫"
        title="No teachers defined"
        description="Add teachers in the Teachers page before setting restrictions."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {teachers.map(teacher => {
        const rs = byTeacher.get(teacher.id) ?? []
        return (
          <div
            key={teacher.id}
            className="rounded-lg border overflow-hidden"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {/* Card header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: 'var(--accent)' }}
                >
                  {teacher.name.charAt(0)}
                </div>
                <span className="text-[13px] font-semibold text-[var(--text-1)] hebrew">
                  {teacher.name}
                </span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => onAvailability(teacher.id)} title="Edit availability grid">
                  🗓 Availability
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onAdd(teacher.id)}>
                  + Add
                </Button>
              </div>
            </div>

            {/* Restriction rows */}
            <div className="px-3 py-2 space-y-0.5 min-h-[48px]">
              {rs.length === 0 ? (
                <p className="py-3 text-[12px] text-[var(--text-3)] text-center italic">
                  No restrictions
                </p>
              ) : (
                rs.map(r => (
                  <div
                    key={r.id}
                    className={['flex items-center gap-2 px-1 py-1.5 rounded group', !r.isActive ? 'opacity-40' : ''].join(' ')}
                  >
                    {/* Tier dot */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: TIER_DOT[r.tier] }}
                      title={TIER_LABEL[r.tier]}
                    />
                    <span className="flex-1 text-[12px] text-[var(--text-2)] truncate">
                      {resolveLabel(r, maps, true)}
                    </span>
                    {r.note && (
                      <span className="hidden group-hover:block text-[10px] text-[var(--text-3)] italic truncate max-w-[100px]">
                        {r.note}
                      </span>
                    )}
                    <button
                      onClick={() => onToggle(r)}
                      className="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={r.isActive ? 'Disable' : 'Enable'}
                    >
                      {r.isActive ? '⏸' : '▶'}
                    </button>
                    <button
                      onClick={() => onDelete(r)}
                      className="text-[11px] text-red-400 hover:text-red-500 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── List tab — flat list for classes/lessons and system ──────────

function ListTab({
  restrictions, maps, onAdd, onToggle, onDelete, emptyTitle, emptyDescription,
}: {
  restrictions: Restriction[]
  maps: EntityMaps
  onAdd: () => void
  onToggle: (r: Restriction) => void
  onDelete: (r: Restriction) => void
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={onAdd}>+ New Restriction</Button>
      </div>

      {restrictions.length === 0 ? (
        <EmptyState icon="🔒" title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="space-y-2">
          {restrictions.map(r => (
            <div
              key={r.id}
              className={['flex items-center gap-3 px-4 py-3 rounded-lg border transition-opacity', !r.isActive ? 'opacity-50' : ''].join(' ')}
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: TIER_DOT[r.tier] }}
                title={TIER_LABEL[r.tier]}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-1)] truncate">
                  {resolveLabel(r, maps)}
                </p>
                {r.note && (
                  <p className="text-[11px] text-[var(--text-3)] mt-0.5 italic">{r.note}</p>
                )}
              </div>
              <Badge variant={TIER_BADGE[r.tier]}>{TIER_LABEL[r.tier]}</Badge>
              {!r.isActive && <Badge variant="neutral">Disabled</Badge>}
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => onToggle(r)} title={r.isActive ? 'Disable' : 'Enable'}>
                  {r.isActive ? '⏸' : '▶'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(r)} className="text-red-500 hover:text-red-600">
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────

export function RestrictionsPage() {
  const { data: restrictions = [], isLoading } = useRestrictions()
  const { data: teachers = [] } = useTeachers()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const { data: lessons = [] } = useLessons()
  const { data: config } = useConfig()
  const createRestriction = useCreateRestriction()
  const updateRestriction = useUpdateRestriction()
  const deleteRestriction = useDeleteRestriction()

  const [activeTab, setActiveTab] = useState<Tab>('teachers')
  const [modalOpen, setModalOpen] = useState(false)
  const [createError, setCreateError] = useState<string>()
  const [deletingRestriction, setDeletingRestriction] = useState<Restriction | null>(null)
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [preselectedTeacherId, setPreselectedTeacherId] = useState<string | undefined>()
  const [bulkTeacherMode, setBulkTeacherMode] = useState(false)
  // Incrementing key forces the form to remount (reset all fields) after "Save & Add Another"
  const [formKey, setFormKey] = useState(0)

  // Availability grid modal
  const [availabilityTeacherId, setAvailabilityTeacherId] = useState<string | null>(null)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const availabilityTeacher = teachers.find(t => t.id === availabilityTeacherId) ?? null

  // Entity maps — used by resolveLabel for readable descriptions
  const maps: EntityMaps = {
    teacherMap: Object.fromEntries(teachers.map(t => [t.id, t])),
    classMap: Object.fromEntries(classes.map(c => [c.id, c])),
    gradeMap: Object.fromEntries(grades.map(g => [g.id, g])),
    subjectMap: Object.fromEntries(subjects.map(s => [s.id, s])),
    lessonMap: Object.fromEntries(lessons.map(l => [l.id, l])),
  }

  // Partition restrictions by tab
  const teacherRestrictions = restrictions.filter(r => TEACHER_TYPES.has(r.type))
  const classLessonRestrictions = restrictions.filter(r => CLASS_TYPES.has(r.type) || LESSON_TYPES_SET.has(r.type))
  const systemRestrictions = restrictions.filter(r =>
    !TEACHER_TYPES.has(r.type) && !CLASS_TYPES.has(r.type) && !LESSON_TYPES_SET.has(r.type)
  )

  const openModal = (teacherId?: string) => {
    setPreselectedTeacherId(teacherId)
    setBulkTeacherMode(false)
    setCreateError(undefined)
    setModalOpen(true)
  }

  const openBulkModal = () => {
    setPreselectedTeacherId(undefined)
    setBulkTeacherMode(true)
    setCreateError(undefined)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setPreselectedTeacherId(undefined)
    setBulkTeacherMode(false)
    setCreateError(undefined)
    setFormKey(0)
  }

  const handleCreate = async (data: CreateRestrictionInput) => {
    setCreateError(undefined)
    try {
      if (bulkTeacherMode) {
        // Create one restriction per teacher — share type/tier/params, vary teacherId
        for (const teacher of teachers) {
          await createRestriction.mutateAsync({ ...data, teacherId: teacher.id })
        }
      } else {
        await createRestriction.mutateAsync(data)
      }
      closeModal()
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to save restriction.')
    }
  }

  /** Save restriction but keep the modal open and remount the form for a fresh entry */
  const handleSaveAndAdd = async (data: CreateRestrictionInput) => {
    setCreateError(undefined)
    try {
      await createRestriction.mutateAsync(data)
      // Reset form fields while keeping modal open and teacher pre-selected
      setFormKey(k => k + 1)
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to save restriction.')
    }
  }

  const handleDelete = async () => {
    if (!deletingRestriction) return
    setDeleteError(undefined)
    try {
      await deleteRestriction.mutateAsync(deletingRestriction.id)
      setDeletingRestriction(null)
      setDeleteError(undefined)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error ?? 'Failed to delete restriction.')
    }
  }

  const toggleActive = async (r: Restriction) => {
    try {
      await updateRestriction.mutateAsync({ id: r.id, data: { isActive: !r.isActive } })
    } catch {
      // React Query reverts the cache on error
    }
  }

  const handleAvailabilitySave = async (cells: AvailabilityCell[]) => {
    if (!availabilityTeacherId) return
    setAvailabilitySaving(true)
    try {
      // Delete all existing TEACHER_UNAVAILABLE_DAY_SLOT restrictions for this teacher
      const existing = restrictions.filter(
        r => r.teacherId === availabilityTeacherId &&
             r.type === RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT
      )
      for (const r of existing) {
        await deleteRestriction.mutateAsync(r.id)
      }
      // Create new ones from the grid
      for (const cell of cells) {
        await createRestriction.mutateAsync({
          type: RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT,
          tier: cell.tier,
          teacherId: availabilityTeacherId,
          params: { day: cell.day, slot: cell.slot },
        })
      }
      setAvailabilityTeacherId(null)
    } finally {
      setAvailabilitySaving(false)
    }
  }

  const TAB_META: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'teachers', label: 'Teachers', count: teacherRestrictions.length },
    { id: 'classes-lessons', label: 'Classes & Lessons', count: classLessonRestrictions.length },
    { id: 'system', label: 'System', count: systemRestrictions.length },
  ]

  if (isLoading) {
    return (
      <AppShell title="Restrictions">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Restrictions">
      {/* Tab bar */}
      <div className="flex gap-0 mb-5 border-b" style={{ borderColor: 'var(--border)' }}>
        {TAB_META.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-[var(--accent)] text-[var(--accent-text)]'
                : 'border-transparent text-[var(--text-2)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'teachers' && (
        <>
          <div className="flex justify-end mb-3">
            <Button variant="secondary" size="sm" onClick={openBulkModal}>
              ⚡ Add rule for all teachers
            </Button>
          </div>
          <TeachersTab
            teachers={teachers}
            restrictions={teacherRestrictions}
            maps={maps}
            onAdd={teacherId => openModal(teacherId)}
            onAvailability={setAvailabilityTeacherId}
            onToggle={toggleActive}
            onDelete={setDeletingRestriction}
          />
        </>
      )}

      {activeTab === 'classes-lessons' && (
        <ListTab
          restrictions={classLessonRestrictions}
          maps={maps}
          onAdd={() => openModal()}
          onToggle={toggleActive}
          onDelete={setDeletingRestriction}
          emptyTitle="No class or lesson rules yet"
          emptyDescription="Add constraints like 'no free windows for 9A' or 'Math preferred in the morning'."
        />
      )}

      {activeTab === 'system' && (
        <>
          {/* Built-in hard invariants — D7 has per-subject exceptions */}
          <HardInvariantsPanel subjects={subjects} />
          <ListTab
            restrictions={systemRestrictions}
            maps={maps}
            onAdd={() => openModal()}
            onToggle={toggleActive}
            onDelete={setDeletingRestriction}
            emptyTitle="No system rules yet"
            emptyDescription="System rules apply globally — e.g. shared lessons require a large room."
          />
        </>
      )}

      {/* Create modal — context-aware title and type filter */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={bulkTeacherMode ? `Add Rule for All ${teachers.length} Teachers` : preselectedTeacherId ? 'Add Teacher Restriction' : 'New Restriction'}
        width="max-w-xl"
      >
        <RestrictionForm
          key={formKey}
          onSave={handleCreate}
          onSaveAndAdd={preselectedTeacherId ? handleSaveAndAdd : undefined}
          onCancel={closeModal}
          loading={createRestriction.isPending}
          error={createError}
          preselectedTeacherId={preselectedTeacherId}
          allowedTypes={ALLOWED_TYPES_BY_TAB[activeTab]}
        />
      </Modal>

      <ConfirmDialog
        open={!!deletingRestriction}
        onClose={() => { setDeletingRestriction(null); setDeleteError(undefined) }}
        onConfirm={handleDelete}
        title="Delete restriction?"
        description="This restriction will be permanently removed."
        confirmLabel="Delete"
        danger
        loading={deleteRestriction.isPending}
        error={deleteError}
      />

      {/* Teacher availability grid modal */}
      {availabilityTeacher && config && (
        <TeacherAvailabilityModal
          open={!!availabilityTeacherId}
          onClose={() => setAvailabilityTeacherId(null)}
          onSave={handleAvailabilitySave}
          saving={availabilitySaving}
          teacher={availabilityTeacher}
          restrictions={restrictions.filter(
            r => r.teacherId === availabilityTeacherId &&
                 r.type === RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT
          )}
          config={config}
        />
      )}
    </AppShell>
  )
}
