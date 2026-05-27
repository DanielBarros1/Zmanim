/**
 * Shared enumerations — mirroring the Prisma schema.
 * These are the source of truth for all enum values used across client and server.
 */

export enum Role {
  ADMIN = 'ADMIN',
  TEACHER = 'TEACHER',
}

export enum Day {
  SUNDAY = 'SUNDAY',
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
}

/** Display order for days — used when rendering the grid */
export const DAY_ORDER: Day[] = [
  Day.SUNDAY,
  Day.MONDAY,
  Day.TUESDAY,
  Day.WEDNESDAY,
  Day.THURSDAY,
]

export enum RoomCapacity {
  STANDARD = 'STANDARD',
  LARGE = 'LARGE',
}

export enum LessonType {
  REGULAR = 'REGULAR',
  SHARED = 'SHARED',
  MATH_GROUP = 'MATH_GROUP',
}

export enum MathLevel {
  THREE_POINT = 'THREE_POINT',
  FOUR_POINT = 'FOUR_POINT',
  FIVE_POINT = 'FIVE_POINT',
}

/** Display labels for math levels */
export const MATH_LEVEL_LABEL: Record<MathLevel, string> = {
  [MathLevel.THREE_POINT]: '3 נק׳',
  [MathLevel.FOUR_POINT]: '4 נק׳',
  [MathLevel.FIVE_POINT]: '5 נק׳',
}

export enum ScheduleState {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum RestrictionTier {
  NON_NEGOTIABLE = 'NON_NEGOTIABLE',
  IMPORTANT = 'IMPORTANT',
  PREFERRED = 'PREFERRED',
  FLEXIBLE = 'FLEXIBLE',
}

/** Display labels for tiers — used in the UI */
export const TIER_LABEL: Record<RestrictionTier, string> = {
  [RestrictionTier.NON_NEGOTIABLE]: 'Non-negotiable',
  [RestrictionTier.IMPORTANT]: 'Important',
  [RestrictionTier.PREFERRED]: 'Preferred',
  [RestrictionTier.FLEXIBLE]: 'Flexible',
}

/** Penalty weights used by the constraint evaluator and auto-scheduler */
export const TIER_PENALTY: Record<RestrictionTier, number> = {
  [RestrictionTier.NON_NEGOTIABLE]: 100_000,
  [RestrictionTier.IMPORTANT]: 1_000,
  [RestrictionTier.PREFERRED]: 10,
  [RestrictionTier.FLEXIBLE]: 1,
}

export enum RestrictionType {
  // Category A — Teacher availability
  TEACHER_UNAVAILABLE_DAY = 'TEACHER_UNAVAILABLE_DAY',
  TEACHER_UNAVAILABLE_SLOT = 'TEACHER_UNAVAILABLE_SLOT',
  TEACHER_UNAVAILABLE_DAY_SLOT = 'TEACHER_UNAVAILABLE_DAY_SLOT',
  TEACHER_MAX_DAYS_PER_WEEK = 'TEACHER_MAX_DAYS_PER_WEEK',
  TEACHER_MIN_DAYS_PER_WEEK = 'TEACHER_MIN_DAYS_PER_WEEK',
  TEACHER_MAX_LESSONS_PER_DAY = 'TEACHER_MAX_LESSONS_PER_DAY',
  TEACHER_MAX_CONSECUTIVE = 'TEACHER_MAX_CONSECUTIVE',
  TEACHER_MAX_WINDOW = 'TEACHER_MAX_WINDOW',
  TEACHER_NO_SINGLE_LESSON_DAY = 'TEACHER_NO_SINGLE_LESSON_DAY',

  // Category B — Class/grade quality
  CLASS_NO_WINDOW = 'CLASS_NO_WINDOW',
  CLASS_MINIMIZE_WINDOWS = 'CLASS_MINIMIZE_WINDOWS',
  CLASS_NO_SUBJECT_TWICE_PER_DAY = 'CLASS_NO_SUBJECT_TWICE_PER_DAY',
  CLASS_ARTS_BALANCE = 'CLASS_ARTS_BALANCE',
  CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS = 'CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS',

  // Category C — Room
  ROOM_LARGE_FOR_SHARED = 'ROOM_LARGE_FOR_SHARED',

  // Category E — Lesson preferences
  LESSON_AVOID_DAY = 'LESSON_AVOID_DAY',
  LESSON_AVOID_SLOT = 'LESSON_AVOID_SLOT',
  LESSON_PREFER_MORNING = 'LESSON_PREFER_MORNING',
  LESSON_PREFER_AFTERNOON = 'LESSON_PREFER_AFTERNOON',
  LESSON_GRADE_SYNC = 'LESSON_GRADE_SYNC',
}

/**
 * Human-readable labels for each restriction type.
 * Used in the Restrictions UI and the violation panel.
 * Placeholders like {teacher}, {day} are filled in at render time.
 */
export const RESTRICTION_TYPE_LABEL: Record<RestrictionType, string> = {
  [RestrictionType.TEACHER_UNAVAILABLE_DAY]: '{teacher} is unavailable on {day}',
  [RestrictionType.TEACHER_UNAVAILABLE_SLOT]: '{teacher} cannot teach at slot {slot}',
  [RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT]: '{teacher} is unavailable on {day} at slot {slot}',
  [RestrictionType.TEACHER_MAX_DAYS_PER_WEEK]: '{teacher} teaches at most {max} days/week',
  [RestrictionType.TEACHER_MIN_DAYS_PER_WEEK]: '{teacher} teaches at least {min} days/week',
  [RestrictionType.TEACHER_MAX_LESSONS_PER_DAY]: '{teacher} has at most {max} lessons/day',
  [RestrictionType.TEACHER_MAX_CONSECUTIVE]: '{teacher} has at most {max} consecutive lessons',
  [RestrictionType.TEACHER_MAX_WINDOW]: '{teacher} has at most {maxSlots} free slots between lessons',
  [RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY]: '{teacher} should not have only one lesson in a day',
  [RestrictionType.CLASS_NO_WINDOW]: '{class} must have no mid-day windows',
  [RestrictionType.CLASS_MINIMIZE_WINDOWS]: '{class} windows should be minimized',
  [RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY]: '{class} should not have {subject} more than once per day',
  [RestrictionType.CLASS_ARTS_BALANCE]: '{class} should have a mix of arts and non-arts each day',
  [RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS]: '{class} should not have {subject} at the first or last slot on more than {maxDays} days/week',
  [RestrictionType.ROOM_LARGE_FOR_SHARED]: 'Shared lessons require a large-capacity room',
  [RestrictionType.LESSON_AVOID_DAY]: '{lesson} should not be placed on {day}',
  [RestrictionType.LESSON_AVOID_SLOT]: '{lesson} should not be placed at slot {slot}',
  [RestrictionType.LESSON_PREFER_MORNING]: '{lesson} is preferred in the morning (slots 1–2)',
  [RestrictionType.LESSON_PREFER_AFTERNOON]: '{lesson} is preferred in the afternoon (slots 3–4)',
  [RestrictionType.LESSON_GRADE_SYNC]: '{subject} must be at the same slot for all {grade} classes',
}
