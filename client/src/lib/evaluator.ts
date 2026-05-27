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

/** D1: Teacher double booked */
function checkTeacherDoubleBooked(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson) return null

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)
  const conflict = existing.find(e => {
    if (e.day !== ctx.proposed.day || e.slot !== ctx.proposed.slot) return false
    const lesson = getLessonById(e.lessonId, ctx.lessons)
    return lesson?.teacherId === proposedLesson.teacherId
  })

  if (!conflict) return null
  return {
    type: 'TEACHER_DOUBLE_BOOKED',
    tier: RestrictionTier.NON_NEGOTIABLE,
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
    // Check if any classId overlaps
    return lesson.classIds.some(cid => proposedLesson.classIds.includes(cid))
  })

  if (!conflict) return null
  return {
    type: 'CLASS_DOUBLE_BOOKED',
    tier: RestrictionTier.NON_NEGOTIABLE,
    message: 'Class already has a lesson at this slot',
    affectedEntryIds: [conflict.id],
  }
}

/** D3: Math groups simultaneity */
function checkMathGroupsSimultaneous(ctx: CheckContext): ClientViolation | null {
  const proposedLesson = getLessonById(ctx.proposed.lessonId, ctx.lessons)
  if (!proposedLesson || proposedLesson.type !== 'MATH_GROUP' || !proposedLesson.gradeId) {
    return null
  }

  const existing = getExistingEntries(ctx.entries, ctx.proposed.excludeEntryId)

  // Find existing math groups for the same grade
  const existingMathGroups = existing.filter(e => {
    const l = getLessonById(e.lessonId, ctx.lessons)
    return l?.type === 'MATH_GROUP' && l.gradeId === proposedLesson.gradeId
  })

  if (existingMathGroups.length === 0) return null

  // All must be at the same day+slot as the proposed
  const firstGroup = existingMathGroups[0]
  if (
    firstGroup.day !== ctx.proposed.day ||
    firstGroup.slot !== ctx.proposed.slot
  ) {
    return {
      type: 'MATH_GROUPS_NOT_SIMULTANEOUS',
      tier: RestrictionTier.NON_NEGOTIABLE,
      message: `Math groups for this grade must all be at ${firstGroup.day} slot ${firstGroup.slot}`,
      affectedEntryIds: existingMathGroups.map(e => e.id),
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

  return violations
}
