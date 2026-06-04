/**
 * Shared entity types — the shapes returned by the API.
 * These mirror the Prisma models but are plain TypeScript interfaces
 * (no Prisma client dependency on the client side).
 */

import {
  Day,
  LessonType,
  MathLevel,
  RestrictionTier,
  RestrictionType,
  Role,
  RoomCapacity,
  ScheduleState,
} from './enums'

// ─── Auth ────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  name: string
  picture: string | null
  role: Role
  teacherId: string | null
  /** True when this user's email is in the ALLOWED_EMAILS env var.
   *  Root users can invite/revoke other users via the User Management page. */
  isRoot: boolean
}

/**
 * One row on the User Management page.
 * Root users (from ALLOWED_EMAILS env) have isRoot=true and no allowedEmailId.
 * Invited users come from the AllowedEmail DB table.
 * userId/name/picture are populated once the person has actually signed in.
 */
export interface UserListItem {
  email: string
  isRoot: boolean
  /** AllowedEmail.id — null for root users (they're not in the DB table) */
  allowedEmailId: string | null
  /** Email of the root user who invited this person; null for root users */
  invitedBy: string | null
  /** ISO string of invite date; null for root users */
  invitedAt: string | null
  /** User.id — null if the person has never signed in */
  userId: string | null
  /** Display name from Google — null if not yet signed in */
  name: string | null
  /** Google profile picture URL — null if not yet signed in */
  picture: string | null
}

// ─── School Config ───────────────────────────────────────────

export interface Recess {
  afterSlot: number      // after which lesson slot the recess occurs
  durationMinutes: number
}

export interface SchoolConfig {
  id: string
  dayStartTime: string   // "08:00"
  lessonDuration: number // minutes
  slotsPerDay: number    // typically 4
  recesses: Recess[]
  workDays: Day[]
  /** Subject IDs exempt from the D7 "no same subject twice per day" hard invariant.
   *  Subjects listed here may be placed at two different slots on the same day.  */
  subjectTwicePerDayAllowed: string[]
}

// ─── Subject ─────────────────────────────────────────────────

export interface Subject {
  id: string
  name: string           // Hebrew
  isArts: boolean
  color: string          // hex from design palette
  specializedRoomId: string | null
}

// ─── Room ────────────────────────────────────────────────────

export interface Room {
  id: string
  name: string           // Hebrew
  capacity: RoomCapacity
}

// ─── Teacher ─────────────────────────────────────────────────

export interface Teacher {
  id: string
  name: string           // Hebrew
  subjectIds: string[]
}

// ─── Grade & Class ───────────────────────────────────────────

export interface Grade {
  id: string
  number: number         // 7–12
}

export interface Class {
  id: string
  gradeId: string
  section: string        // "A" | "B"
}

/** Helper — returns "9A", "10B", etc. */
export function classLabel(cls: Class, grade: Grade): string {
  return `${grade.number}${cls.section}`
}

// ─── Lesson ──────────────────────────────────────────────────

/**
 * One entry in the LessonTeacher join table.
 * PARALLEL: two entries — one per class, each with a non-null classId.
 * MULTI_TEACHER: N entries — one per teacher, each with classId = null (shared room).
 */
export interface LessonTeacherEntry {
  teacherId: string
  classId: string | null
}

export interface Lesson {
  id: string
  type: LessonType
  subjectId: string
  /** Primary teacher — null for PARALLEL and MULTI_TEACHER (use lessonTeachers instead). */
  teacherId: string | null
  hoursPerWeek: number
  /** For REGULAR: one classId. For SHARED/PARALLEL/MULTI_TEACHER: two classIds (same grade). For MATH_GROUP/ENGLISH_GROUP: both class IDs of the grade. */
  classIds: string[]
  /** Required for MATH_GROUP / ENGLISH_GROUP — the grade these groups belong to */
  gradeId: string | null
  mathLevel: MathLevel | null
  /** For ENGLISH_GROUP — same 3/4/5 level structure as math */
  englishLevel: MathLevel | null
  /** PARALLEL and MULTI_TEACHER: per-teacher entries (empty for other types). */
  lessonTeachers: LessonTeacherEntry[]
}

// ─── Schedule ────────────────────────────────────────────────

export interface Schedule {
  id: string
  name: string
  state: ScheduleState
  isStarred: boolean
  createdAt: string      // ISO string
  updatedAt: string
}

export interface ScheduleEntry {
  id: string
  scheduleId: string
  lessonId: string
  day: Day
  slot: number           // 1–4
  roomId: string | null
  /** Second room — only populated for PARALLEL lessons (one room per class-teacher pair) */
  roomId2: string | null
  isSeeded: boolean
  overrides: Override[]
}

export interface Override {
  id: string
  entryId: string
  restrictionType: RestrictionType
  restrictionId: string | null
  note: string | null
  createdAt: string
}

// ─── Restriction ─────────────────────────────────────────────

export interface Restriction {
  id: string
  type: RestrictionType
  tier: RestrictionTier
  teacherId: string | null
  classId: string | null
  gradeId: string | null
  lessonId: string | null
  subjectId: string | null
  /** Type-specific parameters. Shape depends on RestrictionType — see restriction-params.ts */
  params: RestrictionParams
  note: string | null
  isActive: boolean
  createdAt: string
}

// ─── Restriction params (discriminated union per type) ───────

/**
 * Each restriction type has a known params shape.
 * Using a discriminated union keyed by RestrictionType ensures
 * the evaluator always gets correctly typed params.
 */
export type RestrictionParams =
  | { type: RestrictionType.TEACHER_UNAVAILABLE_DAY; day: Day }
  | { type: RestrictionType.TEACHER_UNAVAILABLE_SLOT; slot: number }
  | { type: RestrictionType.TEACHER_UNAVAILABLE_DAY_SLOT; day: Day; slot: number }
  | { type: RestrictionType.TEACHER_MAX_DAYS_PER_WEEK; max: number }
  | { type: RestrictionType.TEACHER_MIN_DAYS_PER_WEEK; min: number }
  | { type: RestrictionType.TEACHER_MAX_LESSONS_PER_DAY; max: number }
  | { type: RestrictionType.TEACHER_MAX_CONSECUTIVE; max: number }
  | { type: RestrictionType.TEACHER_MAX_WINDOW; maxSlots: number }
  | { type: RestrictionType.TEACHER_NO_SINGLE_LESSON_DAY }
  | { type: RestrictionType.CLASS_NO_WINDOW }
  | { type: RestrictionType.CLASS_MINIMIZE_WINDOWS }
  | { type: RestrictionType.CLASS_NO_SUBJECT_TWICE_PER_DAY }
  | { type: RestrictionType.CLASS_ARTS_BALANCE }
  | { type: RestrictionType.CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS; maxDays: number }
  | { type: RestrictionType.ROOM_LARGE_FOR_SHARED }
  | { type: RestrictionType.LESSON_AVOID_DAY; day: Day }
  | { type: RestrictionType.LESSON_AVOID_SLOT; slot: number }
  | { type: RestrictionType.LESSON_PREFER_MORNING }
  | { type: RestrictionType.LESSON_PREFER_AFTERNOON }
  | { type: RestrictionType.LESSON_GRADE_SYNC }

// ─── API request/response shapes ─────────────────────────────

export interface PlaceEntryRequest {
  lessonId: string
  day: Day
  slot: number
  roomId?: string
  overrides?: Array<{
    restrictionType: RestrictionType
    restrictionId?: string
    note?: string
  }>
}

export interface MoveEntryRequest {
  day: Day
  slot: number
  roomId?: string | null
  overrides?: Array<{
    restrictionType: RestrictionType
    restrictionId?: string
    note?: string
  }>
}

export interface ScheduleSummary extends Schedule {
  /** Total lesson placements required (sum of hoursPerWeek across all lessons) */
  totalRequired: number
  /** How many have been placed */
  totalPlaced: number
}
