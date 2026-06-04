/**
 * Suggest-Fix Service
 *
 * Given a violation (type + affected entry IDs), generates a ranked list of
 * concrete move operations that would resolve or reduce it.
 *
 * Algorithm:
 *   1. Compute current schedule score via the authoritative evaluator.
 *   2. For each supported violation type, use a targeted candidate generator
 *      to produce a small set of (entryId, toDay, toSlot) candidates.
 *   3. Pre-filter candidates that would create new D1/D2 hard conflicts.
 *   4. For each remaining candidate, apply the move in-memory and re-evaluate.
 *   5. Return up to MAX_SUGGESTIONS candidates ranked by score improvement
 *      (highest improvement first). Only return candidates that are strictly
 *      better than the current state.
 *
 * Supported violation types (v1):
 *   D1  TEACHER_DOUBLE_BOOKED
 *   D2  CLASS_DOUBLE_BOOKED
 *   D3  MATH_GROUPS_NOT_SIMULTANEOUS
 *   D4  ENGLISH_GROUPS_NOT_SIMULTANEOUS
 *   D7  CLASS_SUBJECT_TWICE_PER_DAY
 *   A1  TEACHER_UNAVAILABLE_DAY
 *   A2  TEACHER_UNAVAILABLE_SLOT
 *   A3  TEACHER_UNAVAILABLE_DAY_SLOT
 *   A6  TEACHER_MAX_LESSONS_PER_DAY
 *   B1  CLASS_NO_WINDOW
 *
 * All other types return an empty array (caller shows "no fix available").
 */

import { evaluate } from './evaluator'

// ─── Types ────────────────────────────────────────────────────────

/**
 * A minimally-typed entry for the suggestion engine.
 * The actual runtime shape has more fields (from the Prisma join).
 */
export interface SuggestEntry {
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
    teacherId: string | null
    gradeId: string | null
    mathLevel: string | null
    englishLevel: string | null
    classes: Array<{ id: string; gradeId: string }>
    subject: { name: string; isArts: boolean; specializedRoomId: string | null }
    lessonTeachers?: Array<{ teacherId: string; classId: string | null }>
    teacher?: { id: string; name: string } | null
  }
}

export interface SuggestInput {
  violationType: string
  affectedEntryIds: string[]
  entries: SuggestEntry[]
  lessons: any[]
  restrictions: any[]
  config: { slotsPerDay: number; workDays: string[]; subjectTwicePerDayAllowed?: string[] }
}

export interface FixSuggestion {
  entryId: string
  /** Subject name (Hebrew) + short class context, e.g. "מתמטיקה (7A)" */
  entryLabel: string
  fromDay: string
  fromSlot: number
  toDay: string
  toSlot: number
  /** Human-readable move description, e.g. "Wednesday slot 2" */
  description: string
  /** currentScore − newScore. Positive means the schedule improves. */
  improvement: number
}

// ─── Constants ────────────────────────────────────────────────────

const MAX_SUGGESTIONS = 3

const DAY_LABEL: Record<string, string> = {
  SUNDAY: 'Sunday', MONDAY: 'Monday', TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
}

// ─── Helpers ──────────────────────────────────────────────────────

/** All teacher IDs for an entry (primary + PARALLEL/MULTI_TEACHER join table) */
function teacherIds(entry: SuggestEntry): Set<string> {
  const ids = new Set<string>()
  if (entry.lesson.teacherId) ids.add(entry.lesson.teacherId)
  for (const lt of entry.lesson.lessonTeachers ?? []) {
    if (lt.teacherId) ids.add(lt.teacherId)
  }
  return ids
}

/** All class IDs for an entry */
function classIds(entry: SuggestEntry): Set<string> {
  return new Set(entry.lesson.classes.map(c => c.id))
}

/**
 * Returns true if moving `entry` to (toDay, toSlot) would create a D1 or D2
 * hard invariant violation with the existing entries.
 * Excludes the entry itself from the check (so it doesn't conflict with its own
 * current position — relevant for move operations).
 */
function wouldConflict(entry: SuggestEntry, toDay: string, toSlot: number, allEntries: SuggestEntry[]): boolean {
  const myTeachers = teacherIds(entry)
  const myClasses  = classIds(entry)

  for (const other of allEntries) {
    if (other.id === entry.id) continue
    if (other.day !== toDay || other.slot !== toSlot) continue

    // D1: Teacher conflict
    const otherTeachers = teacherIds(other)
    for (const tid of myTeachers) {
      if (otherTeachers.has(tid)) return true
    }

    // D2: Class conflict (sibling groups are exempt)
    const isSiblingGroup =
      (entry.lesson.type === 'MATH_GROUP' || entry.lesson.type === 'ENGLISH_GROUP') &&
      entry.lesson.type === other.lesson.type &&
      entry.lesson.gradeId != null &&
      entry.lesson.gradeId === other.lesson.gradeId

    if (!isSiblingGroup) {
      const otherClasses = classIds(other)
      for (const cid of myClasses) {
        if (otherClasses.has(cid)) return true
      }
    }
  }

  return false
}

/** Apply a move in-memory and return the new entries array (does not touch DB) */
function applyMove(entries: SuggestEntry[], entryId: string, toDay: string, toSlot: number): SuggestEntry[] {
  return entries.map(e => e.id === entryId ? { ...e, day: toDay, slot: toSlot } : e)
}

/** Short label for an entry: subject name + first class code */
function label(entry: SuggestEntry): string {
  const subjectName = entry.lesson.subject?.name ?? '?'
  const firstClass  = entry.lesson.classes[0]
  return firstClass ? subjectName : subjectName
}

/**
 * Generate all candidate (toDay, toSlot) positions for a given entry,
 * pre-filtered to those that do not create D1/D2 conflicts.
 */
function freeCandidates(
  entry: SuggestEntry,
  allEntries: SuggestEntry[],
  workDays: string[],
  slotsPerDay: number,
  constraints?: {
    /** Only allow moves to a different day */
    differentDay?: boolean
    /** Only allow moves to a different slot number */
    differentSlot?: boolean
    /** Exclude specific (day, slot) combinations */
    exclude?: Array<{ day: string; slot: number }>
  },
): Array<{ toDay: string; toSlot: number }> {
  const excluded = new Set<string>(
    (constraints?.exclude ?? []).map(({ day, slot }) => `${day}:${slot}`)
  )
  const results: Array<{ toDay: string; toSlot: number }> = []

  for (const day of workDays) {
    for (let slot = 1; slot <= slotsPerDay; slot++) {
      // Skip current position
      if (day === entry.day && slot === entry.slot) continue
      // Apply constraints
      if (constraints?.differentDay && day === entry.day) continue
      if (constraints?.differentSlot && slot === entry.slot) continue
      if (excluded.has(`${day}:${slot}`)) continue
      // Pre-filter hard conflicts
      if (wouldConflict(entry, day, slot, allEntries)) continue
      results.push({ toDay: day, toSlot: slot })
    }
  }

  return results
}

/**
 * Score a set of candidates against the current state.
 * Returns suggestions sorted by improvement (best first), capped at MAX_SUGGESTIONS.
 */
function rankCandidates(
  candidates: Array<{ entryId: string; toDay: string; toSlot: number }>,
  entries: SuggestEntry[],
  lessons: any[],
  restrictions: any[],
  config: { slotsPerDay: number },
  currentScore: number,
): FixSuggestion[] {
  const scored: FixSuggestion[] = []

  for (const c of candidates) {
    const entry = entries.find(e => e.id === c.entryId)
    if (!entry) continue

    const modified = applyMove(entries, c.entryId, c.toDay, c.toSlot)
    const result   = evaluate({
      entries: modified as any,
      lessons,
      restrictions,
      config,
      overrides: [],
      skipRoomCheck: true,   // rooms are reassigned on apply; don't penalise the what-if
    })

    const improvement = currentScore - result.score
    if (improvement <= 0) continue  // skip moves that are neutral or worse

    scored.push({
      entryId:    c.entryId,
      entryLabel: label(entry),
      fromDay:    entry.day,
      fromSlot:   entry.slot,
      toDay:      c.toDay,
      toSlot:     c.toSlot,
      description: `${DAY_LABEL[c.toDay] ?? c.toDay} slot ${c.toSlot}`,
      improvement,
    })
  }

  // Best improvement first; return at most MAX_SUGGESTIONS
  return scored
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, MAX_SUGGESTIONS)
}

// ─── Main entry point ──────────────────────────────────────────────

export function suggestFix(input: SuggestFixInput): FixSuggestion[] {
  const { violationType, affectedEntryIds, entries, lessons, restrictions, config } = input
  const workDays = config.workDays ?? []
  const slotsPerDay = config.slotsPerDay ?? 4

  // Baseline score
  const currentResult = evaluate({
    entries: entries as any,
    lessons,
    restrictions,
    config,
    overrides: [],
    skipRoomCheck: true,
  })
  const currentScore = currentResult.score

  const affectedEntries = entries.filter(e => affectedEntryIds.includes(e.id))

  // ─── Per-type candidate generation ──────────────────────────────

  switch (violationType) {
    // ── D1: Teacher double booked ──────────────────────────────────
    // Two entries at the same slot share a teacher. Move one of them.
    case 'TEACHER_DOUBLE_BOOKED':
    // ── D2: Class double booked ───────────────────────────────────
    // Two entries at the same slot share a class. Move one.
    case 'CLASS_DOUBLE_BOOKED': {
      const candidates = affectedEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── D3/D4: Group lessons not simultaneous ─────────────────────
    // Some group entries exist at a "correct" consensus slot while others
    // are at a different slot. Move the outlier entries to the consensus.
    case 'MATH_GROUPS_NOT_SIMULTANEOUS':
    case 'ENGLISH_GROUPS_NOT_SIMULTANEOUS': {
      const groupType  = violationType === 'MATH_GROUPS_NOT_SIMULTANEOUS' ? 'MATH_GROUP' : 'ENGLISH_GROUP'
      if (affectedEntries.length === 0) return []

      // The affected entries are at an incomplete slot.
      // The consensus slot is the one where MORE group entries are already present.
      const gradeId = affectedEntries[0].lesson.gradeId
      if (!gradeId) return []

      // Find all group entries for this grade
      const allGroupEntries = entries.filter(
        e => e.lesson.type === groupType && e.lesson.gradeId === gradeId,
      )

      // Count group entries per (day, slot)
      const slotCount = new Map<string, number>()
      for (const e of allGroupEntries) {
        const key = `${e.day}:${e.slot}`
        slotCount.set(key, (slotCount.get(key) ?? 0) + 1)
      }

      // Consensus = slot with the most group entries
      let consensusKey = ''
      let maxCount     = 0
      for (const [key, count] of slotCount) {
        if (count > maxCount) { maxCount = count; consensusKey = key }
      }
      if (!consensusKey) return []

      const [consensusDay, consensusSlotStr] = consensusKey.split(':')
      const consensusSlot = Number(consensusSlotStr)

      // Entries NOT at the consensus slot are the outliers to move
      const outliers = allGroupEntries.filter(
        e => !(e.day === consensusDay && e.slot === consensusSlot),
      )

      const candidates = outliers
        .filter(e => !wouldConflict(e, consensusDay, consensusSlot, entries))
        .map(e => ({ entryId: e.id, toDay: consensusDay, toSlot: consensusSlot }))

      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── D7: Same subject twice per day ────────────────────────────
    // Move one of the two same-subject entries to a different day.
    case 'CLASS_SUBJECT_TWICE_PER_DAY': {
      const candidates = affectedEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay, { differentDay: true }).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── A1: Teacher unavailable on day ────────────────────────────
    // Move the affected lesson to any slot on a different day.
    case 'TEACHER_UNAVAILABLE_DAY': {
      const candidates = affectedEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay, { differentDay: true }).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── A2: Teacher unavailable at slot ───────────────────────────
    // Move the affected lesson to a slot with a different slot number.
    case 'TEACHER_UNAVAILABLE_SLOT': {
      const candidates = affectedEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay, { differentSlot: true }).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── A3: Teacher unavailable at specific day+slot ──────────────
    // Move to any other free slot.
    case 'TEACHER_UNAVAILABLE_DAY_SLOT': {
      const candidates = affectedEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── A6: Teacher max lessons per day ───────────────────────────
    // Pick one entry from the overloaded day and move it to a different day.
    case 'TEACHER_MAX_LESSONS_PER_DAY': {
      if (affectedEntries.length === 0) return []
      // Move entries from the day where the teacher is over-limit
      const overloadedDay = affectedEntries[0].day
      const dayEntries    = affectedEntries.filter(e => e.day === overloadedDay)

      const candidates = dayEntries.flatMap(entry =>
        freeCandidates(entry, entries, workDays, slotsPerDay, { differentDay: true }).map(c => ({
          entryId: entry.id,
          ...c,
        }))
      )
      return rankCandidates(candidates, entries, lessons, restrictions, config, currentScore)
    }

    // ── B1: Class has a mid-day window ────────────────────────────
    // Find the gap; try moving the lesson AFTER the gap into the gap slot.
    case 'CLASS_NO_WINDOW': {
      if (affectedEntries.length === 0) return []

      // Identify which day has the window
      const day     = affectedEntries[0].day
      const slots   = [...new Set(affectedEntries.map(e => e.slot))].sort((a, b) => a - b)

      // Find the first gap
      const gapCandidates: Array<{ entryId: string; toDay: string; toSlot: number }> = []
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] - slots[i - 1] > 1) {
          // Gap between slots[i-1] and slots[i]. Try filling it with the entry at slots[i].
          const gapSlot  = slots[i - 1] + 1
          const entryAfter = affectedEntries.find(e => e.day === day && e.slot === slots[i])
          if (entryAfter && !wouldConflict(entryAfter, day, gapSlot, entries)) {
            gapCandidates.push({ entryId: entryAfter.id, toDay: day, toSlot: gapSlot })
          }
          // Also try moving the entry at slots[i-1] one step later (toward the gap)
          const entryBefore = affectedEntries.find(e => e.day === day && e.slot === slots[i - 1])
          if (entryBefore) {
            for (let s = slots[i - 1] + 1; s < slots[i]; s++) {
              if (!wouldConflict(entryBefore, day, s, entries)) {
                gapCandidates.push({ entryId: entryBefore.id, toDay: day, toSlot: s })
              }
            }
          }
        }
      }

      return rankCandidates(gapCandidates, entries, lessons, restrictions, config, currentScore)
    }

    default:
      return []
  }
}

// ─── Type alias to satisfy TypeScript ─────────────────────────────

type SuggestFixInput = SuggestInput
