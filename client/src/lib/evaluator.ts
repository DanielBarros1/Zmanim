/**
 * Client-side constraint evaluator — drag preview only.
 *
 * This is a SIMPLIFIED mirror of the server evaluator (server/src/services/evaluator.ts).
 * It runs instantly during drag-and-drop to highlight likely violations before the
 * server confirms the placement. The server's response is authoritative.
 *
 * We only implement the hard invariants here (D-category) because they are the most
 * visually impactful and easy to compute client-side without full Prisma context.
 * Soft restriction violations (A/B/C/E) are shown from the server's EvaluationResult
 * that is returned with every place/move response.
 *
 * Hard invariants checked:
 *   D1 - Teacher double booked (same teacher, same day+slot)
 *   D2 - Class double booked (same class, same day+slot)
 *   D3 - Math groups simultaneous (all groups of a grade must share a day+slot)
 */

import type { ScheduleEntry, Lesson } from '@zmanim/shared'
import type { HardInvariantType } from '@zmanim/shared'
import { RestrictionTier } from '@zmanim/shared'

export interface ClientViolation {
  type: HardInvariantType
  tier: RestrictionTier
  message: string
  affectedEntryIds: string[]
}

interface CheckContext {
  entries: ScheduleEntry[]
  lessons: Lesson[]
  /** The proposed new entry (not yet in entries list) */
  proposed: {
    lessonId: string
    day: string
    slot: number
    /** Existing entryId if this is a move */
    excludeEntryId?: string
  }
}

function getLessonById(lessonId: string, lessons: Lesson[]): Lesson | undefined {
  return lessons.find(l => l.id === lessonId)
}

function getExistingEntries(
  entries: ScheduleEntry[],
  excludeEntryId?: string,
): ScheduleEntry[] {
  return excludeEntryId ? entries.filter(e => e.id !== excludeEntryId) : entries
}

/** Returns all teacher IDs for a lesson (primary + lessonTeachers) */
function allTeacherIds(lesson: Lesson): Set<string> {
  const ids = new Set<string>()
  if (lesson.teacherId) ids.add(lesson.teacherId)
  for (const lt of lesson.lessonTeachers ?? []) {
    if (lt.teacherId) ids.add(lt.teacherId)
  }
  return ids
}

/** D1: Teacher double booked */
function checkTeacherDoubleBooked(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson) return null
  const proposedTeachers = allTeacherIds(proposedLesson)
  if (proposedTeachers.size === 0) return null

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)
  const conflict = existing.find(e => {
    if (e.day !== ctx.proposed.day || e.slot !== ctx.proposed.slot) return false
    const lesson = getLessonById(e.lessonId, ctx.lessons)
    if (!lesson) return false
    return [...allTeacherIds(lesson)].some(tid => proposedTeachers.has(tid))
  })

  if (!conflict) return null
  return {
    type: 'TEACHER_DOUBLE_BOOKED',
    tier: RestrictionTier.INVARIANT,
    message: 'Teacher is already teaching at this slot',
    affectedEntryIds: [conflict.id],
  }
}

/** D2: Class double booked */
function checkClassDoubleBooked(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson) return null

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)
  const conflict = existing.find(e => {
    if (e.day !== ctx.proposed.day || e.slot !== ctx.proposed.slot) return false
    const lesson = getLessonById(e.lessonId, ctx.lessons)
    if (!lesson) return false
    // Math/English level groups (same type, same grade) are DESIGNED to be simultaneous:
    // students are re-distributed into level groups at the same period, not double-booked.
    // Only skip the check when both lessons are the same group type and the same grade.
    const isSiblingGroup =
      proposedLesson.type === lesson.type &&
      (proposedLesson.type === 'MATH_GROUP' || proposedLesson.type === 'ENGLISH_GROUP') &&
      proposedLesson.gradeId != null &&
      proposedLesson.gradeId === lesson.gradeId
    if (isSiblingGroup) return false
    // Check if any classId overlaps
    return lesson.classIds.some(cid => proposedLesson.classIds.includes(cid))
  })

  if (!conflict) return null
  return {
    type: 'CLASS_DOUBLE_BOOKED',
    tier: RestrictionTier.INVARIANT,
    message: 'Class already has a lesson at this slot',
    affectedEntryIds: [conflict.id],
  }
}

/** D3: Math groups simultaneity
 *
 * The constraint: if math level groups A, B, C exist for a grade, every
 * (day, slot) that contains ANY of them must contain ALL of them.
 *
 * Key nuance: placing the SAME lesson at a second weekly slot (hoursPerWeek > 1)
 * is NOT a violation — that's just the lesson's second occurrence.  We only
 * compare entries from DIFFERENT lessonIds.  If other lessons already have an
 * entry at the proposed slot we're fine (joining the group).  A violation is
 * only raised when other-lessonId entries exist exclusively at a slot that
 * differs from the one being proposed, meaning our proposed slot would be
 * "incomplete" (missing those other groups).
 */
function checkMathGroupsSimultaneous(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson || proposedLesson.type !== 'MATH_GROUP' || !proposedLesson.gradeId) {
    return null
  }

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)

  // Only consider entries from OTHER math group lessons (different lessonId) for the same grade.
  // Same-lessonId entries at other slots are just multi-hour occurrences — not a constraint issue.
  const otherGroupEntries = existing.filter(e => {
    if (e.lessonId === ctx.proposed.lessonId) return false
    const l = getLessonById(e.lessonId, ctx.lessons)
    return l?.type === 'MATH_GROUP' && l.gradeId === proposedLesson.gradeId
  })

  if (otherGroupEntries.length === 0) return null

  // If any other-group entry is already at the proposed slot, we're joining them — OK.
  const anyAtProposed = otherGroupEntries.some(
    e => e.day === ctx.proposed.day && e.slot === ctx.proposed.slot,
  )
  if (anyAtProposed) return null

  // All other-group entries are at a slot different from what we're proposing.
  // That means the proposed placement would create an incomplete (day, slot) group.
  const firstGroup = otherGroupEntries[0]
  return {
    type: 'MATH_GROUPS_NOT_SIMULTANEOUS',
    tier: RestrictionTier.INVARIANT,
    message: `Math level groups for this grade must all share the same time slot. The existing groups are at ${firstGroup.day} slot ${firstGroup.slot} — place this one there too.`,
    affectedEntryIds: otherGroupEntries.map(e => e.id),
  }
}

/** D4: English groups simultaneity — same logic as D3 */
function checkEnglishGroupsSimultaneous(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson || proposedLesson.type !== 'ENGLISH_GROUP' || !proposedLesson.gradeId) {
    return null
  }

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)

  const otherGroupEntries = existing.filter(e => {
    if (e.lessonId === ctx.proposed.lessonId) return false
    const l = getLessonById(e.lessonId, ctx.lessons)
    return l?.type === 'ENGLISH_GROUP' && l.gradeId === proposedLesson.gradeId
  })

  if (otherGroupEntries.length === 0) return null

  const anyAtProposed = otherGroupEntries.some(
    e => e.day === ctx.proposed.day && e.slot === ctx.proposed.slot,
  )
  if (anyAtProposed) return null

  const firstGroup = otherGroupEntries[0]
  return {
    type: 'ENGLISH_GROUPS_NOT_SIMULTANEOUS',
    tier: RestrictionTier.INVARIANT,
    message: `English level groups for this grade must all share the same time slot. The existing groups are at ${firstGroup.day} slot ${firstGroup.slot} — place this one there too.`,
    affectedEntryIds: otherGroupEntries.map(e => e.id),
  }
}

/** D7: Class must not have the same subject at two different slots on the same day.
 *
 * Group entries (MATH_GROUP / ENGLISH_GROUP) at the SAME (day, slot) count as one
 * occurrence — they're simultaneous. Different slots → real violation.
 */
function checkSubjectTwicePerDay(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson) return null

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)

  for (const classId of proposedLesson.classIds) {
    // All entries this class already has on the proposed day
    const sameDayEntries = existing.filter(e => {
      if (e.day !== ctx.proposed.day) return false
      const lesson = getLessonById(e.lessonId, ctx.lessons)
      return lesson?.classIds.includes(classId) ?? false
    })

    // Check for same subject at a DIFFERENT slot
    const conflict = sameDayEntries.find(e => {
      if (e.slot === ctx.proposed.slot) return false  // same slot = fine (sibling groups)
      const lesson = getLessonById(e.lessonId, ctx.lessons)
      return lesson?.subjectId === proposedLesson.subjectId
    })

    if (conflict) {
      return {
        type: 'CLASS_SUBJECT_TWICE_PER_DAY',
        tier: RestrictionTier.INVARIANT,
        message: `This class already has this subject at a different slot on ${ctx.proposed.day}`,
        affectedEntryIds: [conflict.id],
      }
    }
  }

  return null
}

/**
 * Run all client-side checks for a proposed placement.
 * Returns array of violations (may be empty).
 */
export function checkProposed(ctx: CheckContext): ClientViolation[] {
  const violations: ClientViolation[] = []

  const d1 = checkTeacherDoubleBooked(ctx)
  if (d1) violations.push(d1)

  const d2 = checkClassDoubleBooked(ctx)
  if (d2) violations.push(d2)

  const d3 = checkMathGroupsSimultaneous(ctx)
  if (d3) violations.push(d3)

  const d4 = checkEnglishGroupsSimultaneous(ctx)
  if (d4) violations.push(d4)

  const d7 = checkSubjectTwicePerDay(ctx)
  if (d7) violations.push(d7)

  return violations
}
