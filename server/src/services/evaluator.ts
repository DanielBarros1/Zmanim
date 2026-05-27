/**
 * Authoritative constraint evaluator — server side.
 *
 * This is the single source of truth. The client has a mirror of this
 * logic for drag preview (client/src/lib/evaluator.ts) but this version
 * is what persists and what the Review Mode displays.
 *
 * Structure:
 *  - Hard invariants (D-category) are always evaluated first
 *  - Then user-configured restrictions (A/B/C/E categories)
 *  - Violations flagged as overridden if a matching Override record exists
 *  - Final score = sum of penalty weights for non-overridden violations
 */

import {
  EvaluationResult,
  HardInvariantType,
  Violation,
} from '@zmanim/shared'
import { RestrictionTier, RestrictionType } from '@zmanim/shared'
import { TIER_PENALTY } from '@zmanim/shared'

// ─── Input types (Prisma shapes) ──────────────────────────────

interface EvalEntry {
  id: string
  lessonId: string
  day: string
  slot: number
  roomId: string | null
  overrides: Array<{ restrictionType: string; restrictionId: string | null }>
  lesson: {
    id: string
    type: string
    subjectId: string
    teacherId: string
    gradeId: string | null
    mathLevel: string | null
    classes: Array<{ id: string; gradeId: string }>
    subject: { isArts: boolean; specializedRoomId: string | null }
  }
}

interface EvalRestriction {
  id: string
  type: string
  tier: string
  teacherId: string | null
  classId: string | null
  gradeId: string | null
  lessonId: string | null
  subjectId: string | null
  params: any
  isActive: boolean
}

interface EvalConfig {
  slotsPerDay: number
}

interface EvalInput {
  entries: EvalEntry[]
  lessons: any[]
  restrictions: EvalRestriction[]
  config: EvalConfig | null
  overrides: any[]
}

// ─── Main evaluate function ────────────────────────────────────

export function evaluate(input: EvalInput): EvaluationResult {
  const { entries, restrictions, config } = input
  const slotsPerDay = config?.slotsPerDay ?? 4
  const violations: Violation[] = []

  // ── D-category: hard invariants ──────────────────────────────
  violations.push(...checkTeacherDoubleBooked(entries))
  violations.push(...checkClassDoubleBooked(entries))
  violations.push(...checkMathGroupsSimultaneous(entries))
  violations.push(...checkRoomConflict(entries))
  violations.push(...checkSpecializedRoom(entries))

  // ── User-configured restrictions ─────────────────────────────
  for (const r of restrictions) {
    const fn = EVALUATORS[r.type as RestrictionType]
    if (fn) violations.push(...fn(r, entries, slotsPerDay))
  }

  // ── Mark overrides ────────────────────────────────────────────
  for (const v of violations) {
    v.isOverridden = isViolationOverridden(v, entries)
  }

  // ── Score ─────────────────────────────────────────────────────
  const score = violations
    .filter(v => !v.isOverridden)
    .reduce((sum, v) => sum + TIER_PENALTY[v.tier], 0)

  const byTier = {
    NON_NEGOTIABLE: violations.filter(v => v.tier === RestrictionTier.NON_NEGOTIABLE),
    IMPORTANT: violations.filter(v => v.tier === RestrictionTier.IMPORTANT),
    PREFERRED: violations.filter(v => v.tier === RestrictionTier.PREFERRED),
    FLEXIBLE: violations.filter(v => v.tier === RestrictionTier.FLEXIBLE),
  }

  return {
    violations,
    score,
    byTier,
    counts: {
      total: violations.filter(v => !v.isOverridden).length,
      nonNegotiable: byTier.NON_NEGOTIABLE.filter(v => !v.isOverridden).length,
      important: byTier.IMPORTANT.filter(v => !v.isOverridden).length,
      preferred: byTier.PREFERRED.filter(v => !v.isOverridden).length,
      flexible: byTier.FLEXIBLE.filter(v => !v.isOverridden).length,
      overridden: violations.filter(v => v.isOverridden).length,
    },
  }
}

// ─── Hard invariant evaluators ────────────────────────────────

function hardViolation(
  type: HardInvariantType,
  message: string,
  entryIds: string[],
): Violation {
  return {
    restrictionId: null,
    restrictionType: type,
    tier: RestrictionTier.NON_NEGOTIABLE,
    message,
    affectedEntryIds: entryIds,
    isOverridden: false,
  }
}

/** D1: A teacher cannot teach two lessons at the same time */
function checkTeacherDoubleBooked(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  const byTeacherDaySlot = new Map<string, EvalEntry[]>()
  for (const e of entries) {
    const key = `${e.lesson.teacherId}:${e.day}:${e.slot}`
    if (!byTeacherDaySlot.has(key)) byTeacherDaySlot.set(key, [])
    byTeacherDaySlot.get(key)!.push(e)
  }
  for (const [, group] of byTeacherDaySlot) {
    if (group.length > 1) {
      violations.push(hardViolation(
        'TEACHER_DOUBLE_BOOKED',
        `Teacher is scheduled in two places at the same time (${group[0].day}, slot ${group[0].slot})`,
        group.map(e => e.id),
      ))
    }
  }
  return violations
}

/** D2: A class cannot have two lessons at the same time */
function checkClassDoubleBooked(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  const byClassDaySlot = new Map<string, EvalEntry[]>()
  for (const e of entries) {
    for (const cls of e.lesson.classes) {
      const key = `${cls.id}:${e.day}:${e.slot}`
      if (!byClassDaySlot.has(key)) byClassDaySlot.set(key, [])
      byClassDaySlot.get(key)!.push(e)
    }
  }
  for (const [, group] of byClassDaySlot) {
    if (group.length > 1) {
      violations.push(hardViolation(
        'CLASS_DOUBLE_BOOKED',
        `A class has two lessons at the same time (${group[0].day}, slot ${group[0].slot})`,
        group.map(e => e.id),
      ))
    }
  }
  return violations
}

/** D3: All math level groups for the same grade must be at the same time slot */
function checkMathGroupsSimultaneous(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  const mathByGrade = new Map<string, EvalEntry[]>()
  for (const e of entries) {
    if (e.lesson.type === 'MATH_GROUP' && e.lesson.gradeId) {
      if (!mathByGrade.has(e.lesson.gradeId)) mathByGrade.set(e.lesson.gradeId, [])
      mathByGrade.get(e.lesson.gradeId)!.push(e)
    }
  }
  for (const [gradeId, gradeEntries] of mathByGrade) {
    const slots = new Set(gradeEntries.map(e => `${e.day}:${e.slot}`))
    if (slots.size > 1) {
      violations.push(hardViolation(
        'MATH_GROUPS_NOT_SIMULTANEOUS',
        `Math level groups for grade ${gradeId} are not all at the same time slot`,
        gradeEntries.map(e => e.id),
      ))
    }
  }
  return violations
}

/** D5: Two lessons cannot share the same room simultaneously */
function checkRoomConflict(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  const byRoomDaySlot = new Map<string, EvalEntry[]>()
  for (const e of entries) {
    if (!e.roomId) continue
    const key = `${e.roomId}:${e.day}:${e.slot}`
    if (!byRoomDaySlot.has(key)) byRoomDaySlot.set(key, [])
    byRoomDaySlot.get(key)!.push(e)
  }
  for (const [, group] of byRoomDaySlot) {
    if (group.length > 1) {
      violations.push(hardViolation(
        'ROOM_CONFLICT',
        `Two lessons share the same room at ${group[0].day}, slot ${group[0].slot}`,
        group.map(e => e.id),
      ))
    }
  }
  return violations
}

/** D6: A subject with a specialized room must always use that room */
function checkSpecializedRoom(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  for (const e of entries) {
    const specializedRoomId = e.lesson.subject?.specializedRoomId
    if (!specializedRoomId) continue
    if (e.roomId !== specializedRoomId) {
      violations.push(hardViolation(
        'SPECIALIZED_ROOM_VIOLATED',
        `This subject must be taught in its designated room`,
        [e.id],
      ))
    }
  }
  return violations
}

// ─── User-configured restriction evaluators ───────────────────

type RestrictEvaluator = (
  r: EvalRestriction,
  entries: EvalEntry[],
  slotsPerDay: number,
) => Violation[]

function makeViolation(
  r: EvalRestriction,
  message: string,
  entryIds: string[],
): Violation {
  return {
    restrictionId: r.id,
    restrictionType: r.type as RestrictionType,
    tier: r.tier as RestrictionTier,
    message,
    affectedEntryIds: entryIds,
    isOverridden: false,
  }
}

/** Entries for a specific teacher */
function teacherEntries(entries: EvalEntry[], teacherId: string) {
  return entries.filter(e => e.lesson.teacherId === teacherId)
}

/** Entries for a specific class */
function classEntries(entries: EvalEntry[], classId: string) {
  return entries.filter(e => e.lesson.classes.some(c => c.id === classId))
}

/** Group entries by day */
function byDay(entries: EvalEntry[]): Map<string, EvalEntry[]> {
  const map = new Map<string, EvalEntry[]>()
  for (const e of entries) {
    if (!map.has(e.day)) map.set(e.day, [])
    map.get(e.day)!.push(e)
  }
  return map
}

const EVALUATORS: Partial<Record<RestrictionType, RestrictEvaluator>> = {
  // A1: Teacher unavailable on day
  [RestrictionType.TEACHER_UNAVAILABLE_DAY]: (r, entries) => {
    if (!r.teacherId) return []
    return teacherEntries(entries, r.teacherId)
      .filter(e => e.day === r.params.day)
      .map(e => makeViolation(r, `Teacher is unavailable on ${r.params.day}`, [e.id]))
  },

  // A2: Teacher unavailable at slot
  [RestrictionType.TEACHER_UNAVAILABLE_SLOT]: (r, entries) => {
    if (!r.teacherId) return []
    return teacherEntries(entries, r.teacherId)
      .filter(e => e.slot === r.params.slot)
      .map(e => makeViolation(r, `Teacher cannot teach at slot ${r.params.slot}`, [e.id]))
  },

  // A3: Teacher unavailable on specific day+slot
  [RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT]: (r, entries) => {
    if (!r.teacherId) return []
    return teacherEntries(entries, r.teacherId)
      .filter(e => e.day === r.params.day && e.slot === r.params.slot)
      .map(e => makeViolation(r, `Teacher unavailable on ${r.params.day} at slot ${r.params.slot}`, [e.id]))
  },

  // A4: Teacher max days per week
  [RestrictionType.TEACHER_MAX_DAYS_PER_WEEK]: (r, entries) => {
    if (!r.teacherId) return []
    const te = teacherEntries(entries, r.teacherId)
    const days = new Set(te.map(e => e.day))
    if (days.size > r.params.max) {
      return [makeViolation(r,
        `Teacher teaches ${days.size} days/week (max ${r.params.max})`,
        te.map(e => e.id),
      )]
    }
    return []
  },

  // A5: Teacher min days per week
  [RestrictionType.TEACHER_MIN_DAYS_PER_WEEK]: (r, entries) => {
    if (!r.teacherId) return []
    const te = teacherEntries(entries, r.teacherId)
    const days = new Set(te.map(e => e.day))
    if (days.size < r.params.min) {
      return [makeViolation(r,
        `Teacher teaches only ${days.size} days/week (min ${r.params.min})`,
        te.map(e => e.id),
      )]
    }
    return []
  },

  // A6: Teacher max lessons per day
  [RestrictionType.TEACHER_MAX_LESSONS_PER_DAY]: (r, entries) => {
    if (!r.teacherId) return []
    const violations: Violation[] = []
    for (const [, dayEntries] of byDay(teacherEntries(entries, r.teacherId))) {
      if (dayEntries.length > r.params.max) {
        violations.push(makeViolation(r,
          `Teacher has ${dayEntries.length} lessons on ${dayEntries[0].day} (max ${r.params.max})`,
          dayEntries.map(e => e.id),
        ))
      }
    }
    return violations
  },

  // A7: Teacher max consecutive lessons
  [RestrictionType.TEACHER_MAX_CONSECUTIVE]: (r, entries) => {
    if (!r.teacherId) return []
    const violations: Violation[] = []
    for (const [, dayEntries] of byDay(teacherEntries(entries, r.teacherId))) {
      const slots = dayEntries.map(e => e.slot).sort((a, b) => a - b)
      let run = 1
      let runStart = 0
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] === slots[i - 1] + 1) {
          run++
          if (run > r.params.max) {
            violations.push(makeViolation(r,
              `Teacher has ${run} consecutive lessons on ${dayEntries[0].day} (max ${r.params.max})`,
              dayEntries.slice(runStart, i + 1).map(e => e.id),
            ))
          }
        } else {
          run = 1
          runStart = i
        }
      }
    }
    return violations
  },

  // A8: Teacher max window mid-day
  [RestrictionType.TEACHER_MAX_WINDOW]: (r, entries) => {
    if (!r.teacherId) return []
    const violations: Violation[] = []
    for (const [, dayEntries] of byDay(teacherEntries(entries, r.teacherId))) {
      const slots = dayEntries.map(e => e.slot).sort((a, b) => a - b)
      for (let i = 1; i < slots.length; i++) {
        const gap = slots[i] - slots[i - 1] - 1
        if (gap > r.params.maxSlots) {
          violations.push(makeViolation(r,
            `Teacher has a ${gap}-slot window on ${dayEntries[0].day} (max ${r.params.maxSlots})`,
            dayEntries.map(e => e.id),
          ))
        }
      }
    }
    return violations
  },

  // A9: Teacher should not have only one lesson in a day
  [RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY]: (r, entries) => {
    if (!r.teacherId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(teacherEntries(entries, r.teacherId))) {
      if (dayEntries.length === 1) {
        violations.push(makeViolation(r,
          `Teacher has only one lesson on ${day}`,
          dayEntries.map(e => e.id),
        ))
      }
    }
    return violations
  },

  // B1: Class must have no mid-day windows
  [RestrictionType.CLASS_NO_WINDOW]: (r, entries) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(classEntries(entries, r.classId))) {
      const slots = [...new Set(dayEntries.map(e => e.slot))].sort((a, b) => a - b)
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] - slots[i - 1] > 1) {
          violations.push(makeViolation(r,
            `Class has a mid-day window on ${day} (between slots ${slots[i - 1]} and ${slots[i]})`,
            dayEntries.map(e => e.id),
          ))
        }
      }
    }
    return violations
  },

  // B2: Class windows should be minimized
  [RestrictionType.CLASS_MINIMIZE_WINDOWS]: (r, entries) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(classEntries(entries, r.classId))) {
      const slots = [...new Set(dayEntries.map(e => e.slot))].sort((a, b) => a - b)
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] - slots[i - 1] > 1) {
          violations.push(makeViolation(r,
            `Class has a window on ${day}`,
            dayEntries.map(e => e.id),
          ))
        }
      }
    }
    return violations
  },

  // B3: Class should not have same subject more than once per day
  [RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY]: (r, entries) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(classEntries(entries, r.classId))) {
      const subjectCounts = new Map<string, EvalEntry[]>()
      for (const e of dayEntries) {
        if (!subjectCounts.has(e.lesson.subjectId)) subjectCounts.set(e.lesson.subjectId, [])
        subjectCounts.get(e.lesson.subjectId)!.push(e)
      }
      for (const [subjectId, subjectEntries] of subjectCounts) {
        if (subjectEntries.length > 1) {
          violations.push(makeViolation(r,
            `Class has the same subject more than once on ${day}`,
            subjectEntries.map(e => e.id),
          ))
        }
      }
    }
    return violations
  },

  // B4: Class should not have all-arts or all-non-arts day
  [RestrictionType.CLASS_ARTS_BALANCE]: (r, entries) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(classEntries(entries, r.classId))) {
      if (dayEntries.length < 2) continue // can't be unbalanced with fewer than 2 lessons
      const artsCounts = dayEntries.filter(e => e.lesson.subject.isArts).length
      if (artsCounts === 0 || artsCounts === dayEntries.length) {
        violations.push(makeViolation(r,
          `Class has only ${artsCounts === 0 ? 'non-arts' : 'arts'} lessons on ${day}`,
          dayEntries.map(e => e.id),
        ))
      }
    }
    return violations
  },

  // B5: Class should not have same subject at first/last slot more than N days/week
  [RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS]: (r, entries, slotsPerDay) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    const ce = classEntries(entries, r.classId)
    // Group by subject
    const bySubject = new Map<string, EvalEntry[]>()
    for (const e of ce) {
      if (!bySubject.has(e.lesson.subjectId)) bySubject.set(e.lesson.subjectId, [])
      bySubject.get(e.lesson.subjectId)!.push(e)
    }
    for (const [, subEntries] of bySubject) {
      const edgeDays = new Set(
        subEntries
          .filter(e => e.slot === 1 || e.slot === slotsPerDay)
          .map(e => e.day)
      )
      if (edgeDays.size > r.params.maxDays) {
        violations.push(makeViolation(r,
          `Subject appears at the first or last slot on ${edgeDays.size} days (max ${r.params.maxDays})`,
          subEntries.filter(e => e.slot === 1 || e.slot === slotsPerDay).map(e => e.id),
        ))
      }
    }
    return violations
  },

  // E1: Lesson should not be on a specific day
  [RestrictionType.LESSON_AVOID_DAY]: (r, entries) => {
    if (!r.lessonId) return []
    return entries
      .filter(e => e.lessonId === r.lessonId && e.day === r.params.day)
      .map(e => makeViolation(r, `Lesson should not be placed on ${r.params.day}`, [e.id]))
  },

  // E2: Lesson should not be at a specific slot
  [RestrictionType.LESSON_AVOID_SLOT]: (r, entries) => {
    if (!r.lessonId) return []
    return entries
      .filter(e => e.lessonId === r.lessonId && e.slot === r.params.slot)
      .map(e => makeViolation(r, `Lesson should not be placed at slot ${r.params.slot}`, [e.id]))
  },

  // E3: Lesson preferred in morning
  [RestrictionType.LESSON_PREFER_MORNING]: (r, entries) => {
    if (!r.lessonId) return []
    return entries
      .filter(e => e.lessonId === r.lessonId && e.slot > 2)
      .map(e => makeViolation(r, `Lesson is preferred in the morning (slots 1–2)`, [e.id]))
  },

  // E4: Lesson preferred in afternoon
  [RestrictionType.LESSON_PREFER_AFTERNOON]: (r, entries) => {
    if (!r.lessonId) return []
    return entries
      .filter(e => e.lessonId === r.lessonId && e.slot <= 2)
      .map(e => makeViolation(r, `Lesson is preferred in the afternoon (slots 3+)`, [e.id]))
  },

  // E5: Grade sync — all classes in grade must have this lesson at the same slot
  [RestrictionType.LESSON_GRADE_SYNC]: (r, entries) => {
    if (!r.subjectId || !r.gradeId) return []
    const violations: Violation[] = []
    // Find all entries for this subject in the given grade
    const gradeSubjectEntries = entries.filter(e =>
      e.lesson.subjectId === r.subjectId &&
      e.lesson.classes.some(c => c.gradeId === r.gradeId)
    )
    // Group by (day, slot) — all should land in the same group
    const slotGroups = new Map<string, EvalEntry[]>()
    for (const e of gradeSubjectEntries) {
      const key = `${e.day}:${e.slot}`
      if (!slotGroups.has(key)) slotGroups.set(key, [])
      slotGroups.get(key)!.push(e)
    }
    if (slotGroups.size > 1) {
      violations.push(makeViolation(r,
        `Not all classes in the grade have this subject at the same time`,
        gradeSubjectEntries.map(e => e.id),
      ))
    }
    return violations
  },
}

// ─── Override check ────────────────────────────────────────────

/**
 * A violation is overridden if any of its affected entries has an Override record
 * matching the restriction type (and optionally the restriction ID).
 */
function isViolationOverridden(violation: Violation, entries: EvalEntry[]): boolean {
  for (const entryId of violation.affectedEntryIds) {
    const entry = entries.find(e => e.id === entryId)
    if (!entry) continue
    const matched = entry.overrides.some(o =>
      o.restrictionType === violation.restrictionType &&
      (violation.restrictionId === null || o.restrictionId === violation.restrictionId)
    )
    if (matched) return true
  }
  return false
}
