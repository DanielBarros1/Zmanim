/**
 * Evaluator types — shared between the client-side preview evaluator
 * and the authoritative server-side evaluator.
 */

import { RestrictionTier, RestrictionType } from './enums'

// Hard invariant types (Category D — not stored in DB, always evaluated)
// These always use RestrictionTier.INVARIANT and can never be overridden.
export type HardInvariantType =
  | 'TEACHER_DOUBLE_BOOKED'
  | 'CLASS_DOUBLE_BOOKED'
  | 'MATH_GROUPS_NOT_SIMULTANEOUS'
  | 'ENGLISH_GROUPS_NOT_SIMULTANEOUS'
  | 'ROOM_CONFLICT'
  | 'SPECIALIZED_ROOM_VIOLATED'
  | 'LESSON_HOURS_EXCEEDED'
  | 'CLASS_SUBJECT_TWICE_PER_DAY'
  | 'GRADE_MUST_HAVE_FREE_DAY'

export interface Violation {
  /** null for hard invariants (no DB record) */
  restrictionId: string | null
  restrictionType: RestrictionType | HardInvariantType
  tier: RestrictionTier
  /** Human-readable description, ready to display */
  message: string
  /** The entry IDs involved in this violation */
  affectedEntryIds: string[]
  /** True if the admin has applied an override for this violation on the relevant entry */
  isOverridden: boolean
}

export interface EvaluationResult {
  violations: Violation[]
  /** Total penalty score — sum of unoverridden violation weights */
  score: number
  /** Violations grouped by tier for easy display */
  byTier: {
    INVARIANT: Violation[]
    NON_NEGOTIABLE: Violation[]
    IMPORTANT: Violation[]
    PREFERRED: Violation[]
    FLEXIBLE: Violation[]
  }
  /** Counts for the stats bar */
  counts: {
    total: number
    /** Hard invariant violations — physically impossible placements */
    invariant: number
    nonNegotiable: number
    important: number
    preferred: number
    flexible: number
    overridden: number
  }
}
