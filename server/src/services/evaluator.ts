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
  roomId2: string | null
  overrides: Array<{ restrictionType: string; restrictionId: string | null }>
  lesson: {
    id: string
    type: string
    subjectId: string
    /** null for PARALLEL and MULTI_TEACHER — use lessonTeachers instead */
    teacherId: string | null
    gradeId: string | null
    mathLevel: string | null
    englishLevel: string | null
    classes: Array<{ id: string; gradeId: string }>
    subject: { isArts: boolean; specializedRoomId: string | null }
    /** Populated for PARALLEL and MULTI_TEACHER */
    lessonTeachers?: Array<{ teacherId: string; classId: string | null }>
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
  /** Subject IDs exempt from the D7 "same subject twice per day" invariant.
   *  These subjects are allowed to appear at two different slots on the same day. */
  subjectTwicePerDayAllowed?: string[]
}

interface EvalInput {
  entries: EvalEntry[]
  lessons: any[]
  restrictions: EvalRestriction[]
  config: EvalConfig | null
  overrides: any[]
  /**
   * When true, skip D5 (ROOM_CONFLICT) and D6 (SPECIALIZED_ROOM_VIOLATED).
   * Use this inside the auto-scheduler during local search, where rooms have
   * not yet been assigned (all roomId values are null). Room checks are only
   * meaningful after assignRooms() runs.
   */
  skipRoomCheck?: boolean
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
  violations.push(...checkEnglishGroupsSimultaneous(entries))
  if (!input.skipRoomCheck) {
    violations.push(...checkRoomConflict(entries))
    violations.push(...checkSpecializedRoom(entries))
  }
  // D7: pass the exempt subjects so configured exceptions are respected
  const exemptSubjects = new Set(config?.subjectTwicePerDayAllowed ?? [])
  violations.push(...checkNoSubjectTwicePerDay(entries, exemptSubjects))

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
  // INVARIANT violations carry TIER_PENALTY[INVARIANT] = 1 billion each,
  // dwarfing any realistic sum of soft-constraint penalties.
  const score = violations
    .filter(v => !v.isOverridden)
    .reduce((sum, v) => sum + TIER_PENALTY[v.tier], 0)

  const byTier = {
    INVARIANT: violations.filter(v => v.tier === RestrictionTier.INVARIANT),
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
      invariant: byTier.INVARIANT.filter(v => !v.isOverridden).length,
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
    tier: RestrictionTier.INVARIANT,
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
    // Collect all teacher IDs for this entry (primary + lessonTeachers)
    const teacherIds = new Set<string>()
    if (e.lesson.teacherId) teacherIds.add(e.lesson.teacherId)
    for (const lt of e.lesson.lessonTeachers ?? []) {
      if (lt.teacherId) teacherIds.add(lt.teacherId)
    }
    for (const tid of teacherIds) {
      const key = `${tid}:${e.day}:${e.slot}`
      if (!byTeacherDaySlot.has(key)) byTeacherDaySlot.set(key, [])
      byTeacherDaySlot.get(key)!.push(e)
    }
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
      // Math/English level groups (same type, same grade) are DESIGNED to be simultaneous:
      // students are re-distributed into level groups at the same period, not double-booked.
      // All entries in the cell-group must be the same lesson type and same grade for the
      // exemption to apply; any mix with regular/shared lessons is still a violation.
      const allSiblingGroups =
        group.every(e =>
          (e.lesson.type === 'MATH_GROUP' || e.lesson.type === 'ENGLISH_GROUP') &&
          e.lesson.gradeId != null,
        ) &&
        new Set(group.map(e => e.lesson.type)).size === 1 &&    // all same type (MATH or ENGLISH)
        new Set(group.map(e => e.lesson.gradeId)).size === 1    // all same grade

      if (allSiblingGroups) continue

      violations.push(hardViolation(
        'CLASS_DOUBLE_BOOKED',
        `A class has two lessons at the same time (${group[0].day}, slot ${group[0].slot})`,
        group.map(e => e.id),
      ))
    }
  }
  return violations
}

/**
 * D3: All math level groups for the same grade must be placed simultaneously —
 * every (day, slot) that contains ANY math group entry for a grade must contain
 * entries from ALL distinct math group lessons for that grade.
 *
 * "All at the same slot" does NOT mean "every entry has the same slot".
 * A lesson with hoursPerWeek=2 legitimately has entries at two different
 * (day, slot) pairs.  What we enforce is: for each (day, slot) where at least
 * one math group lesson appears, EVERY other math group lesson for the grade
 * must also appear there.  Two entries of the SAME lesson at different slots
 * do not trigger a violation.
 */
function checkMathGroupsSimultaneous(entries: EvalEntry[]): Violation[] {
  return checkGroupSimultaneous(entries, 'MATH_GROUP', 'MATH_GROUPS_NOT_SIMULTANEOUS', 'Math')
}

/** D4: Same constraint for English level groups */
function checkEnglishGroupsSimultaneous(entries: EvalEntry[]): Violation[] {
  return checkGroupSimultaneous(entries, 'ENGLISH_GROUP', 'ENGLISH_GROUPS_NOT_SIMULTANEOUS', 'English')
}

function checkGroupSimultaneous(
  entries: EvalEntry[],
  groupType: string,
  violationType: HardInvariantType,
  label: string,
): Violation[] {
  const violations: Violation[] = []

  // Collect all distinct lessonIds per grade for this group type
  const distinctLessonsByGrade = new Map<string, Set<string>>()
  for (const e of entries) {
    if (e.lesson.type === groupType && e.lesson.gradeId) {
      if (!distinctLessonsByGrade.has(e.lesson.gradeId)) {
        distinctLessonsByGrade.set(e.lesson.gradeId, new Set())
      }
      distinctLessonsByGrade.get(e.lesson.gradeId)!.add(e.lessonId)
    }
  }

  for (const [gradeId, distinctLessonIds] of distinctLessonsByGrade) {
    // Only a single lesson exists for this grade — nothing to be simultaneous with
    if (distinctLessonIds.size <= 1) continue

    // For each (day, slot) that has at least one group entry, track which lessonIds are present
    const slotLessonIds = new Map<string, Set<string>>()
    const slotEntryIds = new Map<string, string[]>()

    for (const e of entries) {
      if (e.lesson.type !== groupType || e.lesson.gradeId !== gradeId) continue
      const key = `${e.day}:${e.slot}`
      if (!slotLessonIds.has(key)) {
        slotLessonIds.set(key, new Set())
        slotEntryIds.set(key, [])
      }
      slotLessonIds.get(key)!.add(e.lessonId)
      slotEntryIds.get(key)!.push(e.id)
    }

    // Any slot that does not have the full set of lessons is a violation
    for (const [key, presentIds] of slotLessonIds) {
      if (presentIds.size < distinctLessonIds.size) {
        violations.push(hardViolation(
          violationType,
          `${label} level groups for grade ${gradeId} are not all at the same time slot (${key})`,
          slotEntryIds.get(key)!,
        ))
      }
    }
  }

  return violations
}

/** D5: Two lessons cannot share the same room simultaneously */
function checkRoomConflict(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  const byRoomDaySlot = new Map<string, EvalEntry[]>()

  // Index all room assignments (primary and secondary) into the same map
  // so conflicts between any combination of roomId / roomId2 are detected.
  for (const e of entries) {
    for (const rid of [e.roomId, e.roomId2]) {
      if (!rid) continue
      const key = `${rid}:${e.day}:${e.slot}`
      if (!byRoomDaySlot.has(key)) byRoomDaySlot.set(key, [])
      byRoomDaySlot.get(key)!.push(e)
    }
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

/**
 * D6: A subject with a specialized room should use that room.
 *
 * Tier: NON_NEGOTIABLE (not INVARIANT) — per product spec §6:
 * "Placement is never blocked by room unavailability — it's flagged as a warning."
 * A wrong-room assignment is a scheduling quality issue the admin can fix manually
 * by reassigning the room badge on the lesson card. It is NOT a physical impossibility
 * the way a teacher or class double-booking is. Using INVARIANT here would cause the
 * auto-scheduler to refuse to surface schedules whenever room slots are tight.
 */
function checkSpecializedRoom(entries: EvalEntry[]): Violation[] {
  const violations: Violation[] = []
  for (const e of entries) {
    const specializedRoomId = e.lesson.subject?.specializedRoomId
    if (!specializedRoomId) continue
    // Accept if roomId OR roomId2 matches — PARALLEL lessons use two rooms
    if (e.roomId !== specializedRoomId && e.roomId2 !== specializedRoomId) {
      violations.push({
        restrictionId: null,
        restrictionType: 'SPECIALIZED_ROOM_VIOLATED' as any,
        tier: RestrictionTier.NON_NEGOTIABLE,
        message: 'This subject must be taught in its designated room — please reassign the room badge',
        affectedEntryIds: [e.id],
        isOverridden: false,
      })
    }
  }
  return violations
}

/**
 * D7: A class must not have the same subject at more than one time slot on the same day.
 *
 * Exception built-in: Math/English group entries that share the SAME (day, slot) are
 * simultaneous — students are re-distributed into exactly one group, so they count
 * as a single occurrence.  Because we group by (day:slot), multiple group entries at
 * the same slot all land in the same bucket → size 1 → no violation.
 * If group entries are spread over two different slots (D3/D4 violation), this check
 * correctly fires as well.
 *
 * @param exemptSubjectIds - Subject IDs configured as allowed to appear twice per day
 *   (set via the System tab in Restrictions → D7 Exceptions). Violations for these
 *   subjects are silently skipped — the hard invariant is effectively lifted for them.
 */
function checkNoSubjectTwicePerDay(entries: EvalEntry[], exemptSubjectIds: Set<string> = new Set()): Violation[] {
  const violations: Violation[] = []

  // index: classId → day → subjectId → slotKey → EvalEntry[]
  const index = new Map<string, Map<string, Map<string, Map<string, EvalEntry[]>>>>()

  for (const e of entries) {
    for (const cls of e.lesson.classes) {
      let byDay = index.get(cls.id)
      if (!byDay) { byDay = new Map(); index.set(cls.id, byDay) }

      let bySubject = byDay.get(e.day)
      if (!bySubject) { bySubject = new Map(); byDay.set(e.day, bySubject) }

      let bySlot = bySubject.get(e.lesson.subjectId)
      if (!bySlot) { bySlot = new Map(); bySubject.set(e.lesson.subjectId, bySlot) }

      const key = `${e.day}:${e.slot}`
      if (!bySlot.has(key)) bySlot.set(key, [])
      bySlot.get(key)!.push(e)
    }
  }

  for (const [, byDay] of index) {
    for (const [day, bySubject] of byDay) {
      for (const [subjectId, bySlot] of bySubject) {
        if (bySlot.size <= 1) continue
        // Same subject appears at 2+ distinct time slots on this day for this class.
        // Skip if this subject has been explicitly exempted by the user.
        if (exemptSubjectIds.has(subjectId)) continue
        const allEntries = [...bySlot.values()].flat()
        violations.push(hardViolation(
          'CLASS_SUBJECT_TWICE_PER_DAY',
          `Class has the same subject at ${bySlot.size} different slots on ${day}`,
          allEntries.map(e => e.id),
        ))
      }
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

/** Entries for a specific teacher (checks both primary teacherId and lessonTeachers) */
function teacherEntries(entries: EvalEntry[], teacherId: string) {
  return entries.filter(e =>
    e.lesson.teacherId === teacherId ||
    (e.lesson.lessonTeachers ?? []).some(lt => lt.teacherId === teacherId)
  )
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
  // Uses the same slot-key deduplication as D7: multiple group entries at the SAME
  // (day, slot) count as one occurrence (students are in exactly one group).
  [RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY]: (r, entries) => {
    if (!r.classId) return []
    const violations: Violation[] = []
    for (const [day, dayEntries] of byDay(classEntries(entries, r.classId))) {
      // Group by subjectId → then by slotKey
      const subjectSlots = new Map<string, Map<string, EvalEntry[]>>()
      for (const e of dayEntries) {
        if (!subjectSlots.has(e.lesson.subjectId)) subjectSlots.set(e.lesson.subjectId, new Map())
        const bySlot = subjectSlots.get(e.lesson.subjectId)!
        const key = `${e.day}:${e.slot}`
        if (!bySlot.has(key)) bySlot.set(key, [])
        bySlot.get(key)!.push(e)
      }
      for (const [, bySlot] of subjectSlots) {
        if (bySlot.size > 1) {
          const allEntries = [...bySlot.values()].flat()
          violations.push(makeViolation(r,
            `Class has the same subject more than once on ${day}`,
            allEntries.map(e => e.id),
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

  // E5: Grade sync — all classes in the grade must have this subject at the same slots.
  //
  // Correct semantics: for every (day, slot) where any class in the grade has this
  // subject, ALL classes in the grade must also have it there.
  //
  // This replaces the old "slotGroups.size > 1" check which incorrectly fired
  // whenever a lesson had hoursPerWeek > 1 (multi-hour lessons legitimately occupy
  // multiple (day, slot) pairs — that is NOT a sync violation).
  [RestrictionType.LESSON_GRADE_SYNC]: (r, entries) => {
    if (!r.subjectId || !r.gradeId) return []

    // All entries for this subject whose lesson touches the given grade
    const gradeSubjectEntries = entries.filter(e =>
      e.lesson.subjectId === r.subjectId &&
      e.lesson.classes.some(c => c.gradeId === r.gradeId),
    )
    if (gradeSubjectEntries.length === 0) return []

    // Collect every class ID in this grade that is enrolled in this subject
    const allGradeClassIds = new Set<string>()
    for (const e of gradeSubjectEntries) {
      for (const c of e.lesson.classes) {
        if (c.gradeId === r.gradeId) allGradeClassIds.add(c.id)
      }
    }
    // Only one class has this subject — nothing to sync
    if (allGradeClassIds.size <= 1) return []

    // For each (day, slot) bucket, which class IDs are represented?
    const slotData = new Map<string, { classIds: Set<string>; entryIds: string[] }>()
    for (const e of gradeSubjectEntries) {
      const key = `${e.day}:${e.slot}`
      if (!slotData.has(key)) slotData.set(key, { classIds: new Set(), entryIds: [] })
      const bucket = slotData.get(key)!
      bucket.entryIds.push(e.id)
      for (const c of e.lesson.classes) {
        if (c.gradeId === r.gradeId) bucket.classIds.add(c.id)
      }
    }

    // A slot is a violation if it doesn't cover all classes
    const violations: Violation[] = []
    for (const [key, { classIds, entryIds }] of slotData) {
      if (classIds.size < allGradeClassIds.size) {
        violations.push(makeViolation(r,
          `Not all classes in the grade have this subject at the same time (${key})`,
          entryIds,
        ))
      }
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
