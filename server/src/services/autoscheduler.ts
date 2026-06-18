/**
 * Auto-scheduler service
 *
 * Implements random-restart penalty-minimization with local search.
 *
 * Runs as an async background task in the main thread (NOT a worker thread).
 * Worker threads require the same runtime that launched the server — under
 * `tsx watch` that means the worker would need tsx too, which `new Worker(__filename)`
 * does not provide.  setImmediate() between restarts keeps the event loop
 * free enough for polling requests and is perfectly fine for an admin-only tool.
 *
 * Algorithm per restart:
 *   1. Copy seeded entries (immovable anchors)
 *   2. Expand all lessons into placement instances (one per required hour)
 *   3. Randomly assign unplaced instances to (day, slot) combinations
 *   4. Run local search: repeatedly try swapping or moving two entries,
 *      keep the change if it reduces the penalty score
 *   5. Track the best schedule across all restarts
 *
 * Seeding:
 *   When seedScheduleId is provided, ALL entries from that schedule are used
 *   as fixed anchors (isSeeded = true) so the algorithm never moves them.
 *   This lets admins preserve a hand-crafted partial schedule and let the
 *   auto-scheduler fill in the rest.
 *
 * On completion: creates a new DRAFT Schedule in the DB and updates the job record.
 */

import { prisma } from '../db'
import { evaluate } from './evaluator'
import { DAY_ORDER } from '@zmanim/shared'

// ─── Job tracking (in-memory) ─────────────────────────────────

/** One saved candidate returned to the client when the job completes. */
export interface CandidateResult {
  scheduleId: string
  name: string
  /** Raw penalty score — lower is better (used for relative ranking only) */
  score: number
  violations: {
    total: number
    nonNegotiable: number
    important: number
    preferred: number
    flexible: number
  }
}

export type JobStatus = {
  jobId: string
  status: 'RUNNING' | 'DONE' | 'ERROR'
  progress: number        // 0–100
  statusMessage?: string  // human-readable phase description shown in the modal
  /** Up to 3 saved candidate schedules (set when status === 'DONE') */
  candidates?: CandidateResult[]
  scheduleId?: string     // convenience: candidates[0].scheduleId
  error?: string
}

const jobs = new Map<string, JobStatus>()

/** Patch a running job's fields without replacing the whole record. */
function patchJob(jobId: string, patch: Partial<JobStatus>): void {
  const job = jobs.get(jobId)
  if (job) Object.assign(job, patch)
}

export function getJob(jobId: string): JobStatus | undefined {
  return jobs.get(jobId)
}

// ─── Start a job ───────────────────────────────────────────────

interface JobInput {
  jobId: string
  name: string
  seedScheduleId?: string
  nRestarts: number
  nIterations: number
}

export function startAutoSchedulerJob(input: JobInput): void {
  jobs.set(input.jobId, { jobId: input.jobId, status: 'RUNNING', progress: 0, statusMessage: 'Loading data…' })

  // Fire async without awaiting — the HTTP response is sent before this runs.
  // setImmediate defers to the next event-loop tick so the 202 reply goes out first.
  setImmediate(() => runJob(input))
}

async function runJob(input: JobInput): Promise<void> {
  try {
    // ── Load all data the algorithm needs ──────────────────────────
    const [lessons, restrictions, config, rooms, seedEntries] = await Promise.all([
      prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true, lessonTeachers: true } }),
      prisma.restriction.findMany({ where: { isActive: true } }),
      prisma.schoolConfig.findFirst(),
      prisma.room.findMany(),
      input.seedScheduleId
        ? prisma.scheduleEntry.findMany({
            where: { scheduleId: input.seedScheduleId },
            include: { overrides: true },
          })
        : Promise.resolve([]),
    ])

    const slotsPerDay = config?.slotsPerDay ?? 4
    const days = config?.workDays?.length ? config.workDays : DAY_ORDER
    const totalSlotsPerClass = slotsPerDay * days.length
    // Shared eval config object — passed to all evaluate() calls so the D7 exemption
    // list is respected during local search and gate checks.
    const evalConfig = {
      slotsPerDay,
      subjectTwicePerDayAllowed: (config as any)?.subjectTwicePerDayAllowed ?? [],
    }

    // ── Hard teacher availability ──────────────────────────────────
    // INVARIANT-tier teacher restrictions represent physical impossibilities
    // (e.g. teacher does not work on Mondays).  The backtracker and Phase A/A'
    // placement treat these as absolutely blocked slots — they are never relaxed
    // even in the deepest fallback tiers.
    const hardTeacherAvail = new Map<string, HardAvail>()
    for (const r of restrictions) {
      if ((r as any).tier !== 'INVARIANT' || !(r as any).teacherId || !(r as any).isActive) continue
      const p = (r as any).params as any
      const tid = (r as any).teacherId as string
      if (!hardTeacherAvail.has(tid)) {
        hardTeacherAvail.set(tid, { days: new Set(), daySlots: new Set(), slots: new Set() })
      }
      const ha = hardTeacherAvail.get(tid)!
      if      ((r as any).type === 'TEACHER_UNAVAILABLE_DAY'       && p.day)                    ha.days.add(p.day)
      else if ((r as any).type === 'TEACHER_UNAVAILABLE_DAY_SLOT'   && p.day && p.slot != null) ha.daySlots.add(`${p.day}:${p.slot}`)
      else if ((r as any).type === 'TEACHER_UNAVAILABLE_SLOT'       && p.slot != null)          ha.slots.add(p.slot)
    }
    if (hardTeacherAvail.size > 0) {
      console.log(`[AutoScheduler] Hard teacher availability: ${hardTeacherAvail.size} teacher(s) with INVARIANT restrictions`)
    }

    // Soft-constraint penalty lookup for backtracker value ordering.
    // Teachers with NON_NEGOTIABLE/IMPORTANT/PREFERRED/FLEXIBLE availability
    // restrictions will have their unavailable days sorted to the END of the
    // backtracker's slot list, so the CSP's initial placement naturally avoids them.
    const softLookup = buildSoftLookup(restrictions)

    // ── Expand lessons into individual placement instances ─────────
    // Each lesson with hoursPerWeek=N generates N independent placements.
    const instances = expandLessons(lessons)

    // Count how many entries the seed schedule has per lesson.
    // We do COUNT-based exclusion (not lessonId-based presence) so that a partial
    // seed schedule (e.g. a lesson with hoursPerWeek=3 but only 2 seed entries)
    // does NOT silently drop the unseeded hours — only the seeded instances are
    // excluded, and the remainder are placed by the algorithm.
    const seededCountPerLesson = new Map<string, number>()
    for (const e of seedEntries) {
      seededCountPerLesson.set(e.lessonId, (seededCountPerLesson.get(e.lessonId) ?? 0) + 1)
    }
    // seededLessonIds: still used for occupancy checks and Gate 3 below.
    const seededLessonIds = new Set(seededCountPerLesson.keys())

    // Build toPlace: for each lesson, include exactly (hoursPerWeek − seededCount) instances.
    const toPlace: { lessonId: string; lesson: any }[] = []
    const instSeenCount = new Map<string, number>()
    for (const inst of instances) {
      const seen   = instSeenCount.get(inst.lessonId) ?? 0
      const seeded = seededCountPerLesson.get(inst.lessonId) ?? 0
      instSeenCount.set(inst.lessonId, seen + 1)
      if (seen < seeded) continue  // this instance is covered by a seed entry
      toPlace.push(inst)
    }

    // ── Feasibility diagnostics ────────────────────────────────────
    // For each class, compute total lesson hours (counting group lessons by their
    // max hours across levels, since all levels run in parallel and consume a single
    // "class slot").  Warn if any class exceeds the available slot budget.
    patchJob(input.jobId, { statusMessage: 'Checking feasibility…' })

    console.log(`\n[AutoScheduler] ═══════════════════════════════════════`)
    console.log(`[AutoScheduler] Job ${input.jobId} — ${input.name}`)
    console.log(`[AutoScheduler] ${lessons.length} lessons | ${slotsPerDay} slots/day × ${days.length} days = ${totalSlotsPerClass} slots/class`)

    // Group lessons by type for summary
    const byType = new Map<string, number>()
    for (const l of lessons) {
      byType.set(l.type, (byType.get(l.type) ?? 0) + 1)
    }
    console.log(`[AutoScheduler] Lesson types: ${[...byType.entries()].map(([t, n]) => `${t}×${n}`).join(', ')}`)

    // Compute per-class hour demand (group lessons contribute max hrs, not sum)
    const regularHoursPerClass = new Map<string, number>()
    const groupHoursByGradeType = new Map<string, number>()  // "gradeId:type" → max hrs

    for (const l of lessons) {
      if (l.type === 'MATH_GROUP' || l.type === 'ENGLISH_GROUP') {
        const key = `${l.gradeId}:${l.type}`
        groupHoursByGradeType.set(key, Math.max(groupHoursByGradeType.get(key) ?? 0, l.hoursPerWeek))
      } else {
        for (const cls of l.classes) {
          regularHoursPerClass.set(cls.id, (regularHoursPerClass.get(cls.id) ?? 0) + l.hoursPerWeek)
        }
      }
    }

    // Map class → grade for group hour attribution
    const classGradeMap = new Map<string, string>()
    for (const l of lessons) {
      for (const cls of l.classes) classGradeMap.set(cls.id, cls.gradeId)
    }

    let anyInfeasible = false
    for (const [classId, regularHrs] of regularHoursPerClass) {
      const gradeId = classGradeMap.get(classId) ?? ''
      const mathHrs   = groupHoursByGradeType.get(`${gradeId}:MATH_GROUP`)    ?? 0
      const englishHrs = groupHoursByGradeType.get(`${gradeId}:ENGLISH_GROUP`) ?? 0
      const total = regularHrs + mathHrs + englishHrs
      const status = total > totalSlotsPerClass ? '❌ INFEASIBLE' : total > totalSlotsPerClass * 0.9 ? '⚠ TIGHT' : '✓'
      if (total > totalSlotsPerClass) anyInfeasible = true
      console.log(`[AutoScheduler]   Class ${classId.slice(-6)}: ${regularHrs} regular + ${mathHrs} math-group + ${englishHrs} english-group = ${total}/${totalSlotsPerClass} slots  ${status}`)
    }
    if (anyInfeasible) {
      console.warn(`[AutoScheduler] ⚠ Some classes are INFEASIBLE — violations will remain regardless of iterations`)
    }
    console.log(`[AutoScheduler] ───────────────────────────────────────`)

    // ── Best candidate tracking ────────────────────────────────────
    // We keep only the single best restart to minimise peak memory usage.
    // Ranking: invariants → classConflicts → gradeSyncConflicts → hardCount → score.
    interface Candidate {
      entries: any[]
      score: number
      hardCount: number
      classConflicts: number
      gradeSyncConflicts: number
      invariantCount: number
    }
    let bestCandidate: Candidate | null = null

    function isBetterCandidate(a: Candidate, b: Candidate): boolean {
      if (a.invariantCount     !== b.invariantCount)     return a.invariantCount     < b.invariantCount
      if (a.classConflicts     !== b.classConflicts)     return a.classConflicts     < b.classConflicts
      if (a.gradeSyncConflicts !== b.gradeSyncConflicts) return a.gradeSyncConflicts < b.gradeSyncConflicts
      if (a.hardCount          !== b.hardCount)          return a.hardCount          < b.hardCount
      return a.score < b.score
    }

    // ── Seed validation (Gate S): surface hard D-invariants in the seed ──
    // Seeded entries are user-verified fixed anchors.  Violations within them are
    // ACCEPTED — the user deliberately placed those lessons despite the conflict.
    // Gate 2 and local search exclude seeded-only violations so they don't block
    // the run or distort the SA temperature.
    //
    // Gate S just logs a warning so the situation is visible in the server logs.
    // It never blocks the run.
    let nSeedInvariants = 0
    if (seedEntries.length > 0) {
      const seedForEval = seedEntries.map((se: any) => ({
        id: `seed-${se.id}`,
        lessonId: se.lessonId,
        day: se.day,
        slot: se.slot,
        roomId:  se.roomId  ?? null,
        roomId2: se.roomId2 ?? null,
        isSeeded: true,
        overrides: [],
        lesson: lessons.find((l: any) => l.id === se.lessonId),
      })).filter((e: any) => e.lesson)

      const seedGateCheck = evaluate({
        entries: seedForEval as any,
        lessons: lessons as any,
        restrictions: [],
        config: evalConfig,
        overrides: [],
        skipRoomCheck: true,
      })

      nSeedInvariants = seedGateCheck.counts.invariant
      if (nSeedInvariants > 0) {
        const breakdown = seedGateCheck.violations
          .filter((v: any) => v.tier === 'INVARIANT')
          .reduce((m: Map<string, number>, v: any) => {
            const t = String(v.restrictionType)
            m.set(t, (m.get(t) ?? 0) + 1)
            return m
          }, new Map<string, number>())
        const detail = [...breakdown.entries()].map(([t, n]) => `${t}×${n}`).join(', ')
        console.warn(
          `[AutoScheduler] ⚠ Seed has ${nSeedInvariants} hard invariant violation(s): ${detail} — ` +
          `treating as user-accepted (excluded from Gate 2 and local search hard count)`
        )
      } else {
        console.log(`[AutoScheduler] Seed validation: ${seedEntries.length} seeded entries, 0 hard violations`)
      }
    }

    /**
     * Returns true when ALL entry IDs in a violation are seeded entries.
     * Such violations are user-accepted (the seed was manually verified) and are
     * excluded from Gate 2 and from the local-search hard-violation count so they
     * don't block the run or distort simulated annealing.
     */
    function isSeededOnlyViolation(v: any, seededIds: Set<string>): boolean {
      const ids = v.affectedEntryIds as string[]
      return ids.length > 0 && ids.every((id: string) => seededIds.has(id))
    }

    // Backtracking diagnostics — used to build an informative error if all restarts fail.
    let nSkippedRestarts    = 0  // restarts where backtracking returned null (timed-out OR infeasible)
    let nInfeasibleRestarts = 0  // restarts where backtracking PROVED infeasibility (not timed out)

    // ── Main loop: nRestarts × nIterations ────────────────────────
    for (let restart = 0; restart < input.nRestarts; restart++) {
      patchJob(input.jobId, {
        statusMessage: `Restart ${restart + 1}/${input.nRestarts} — placing groups…`,
        progress: Math.round((restart / input.nRestarts) * 95),  // reserve last 5% for finalization
      })

      // Step 1: Fixed seed entries (all entries from the chosen schedule)
      let entries: any[] = seedEntries.map((se: any) => ({
        id: `seed-${se.id}`,
        lessonId: se.lessonId,
        day: se.day,
        slot: se.slot,
        roomId:  se.roomId  ?? null,
        roomId2: se.roomId2 ?? null,
        isSeeded: true,
        overrides: se.overrides ?? [],
        lesson: lessons.find((l: any) => l.id === se.lessonId),
      })).filter((e: any) => e.lesson)  // drop any orphan entries

      // Step 2: Greedy initial placement — hard-constraint-aware.
      //
      // Phase A  — Synchronized groups (MATH_GROUP / ENGLISH_GROUP per grade)
      //   All level groups for the same subject+grade MUST occupy the SAME set
      //   of (day, slot) pairs (invariant D3/D4).  We place them together first:
      //   find slots where ALL the group's teachers are free, then assign every
      //   group lesson instance of that "slot index" to the same slot.
      //
      // Phase B  — Everything else (REGULAR / SHARED)
      //   Greedily find a (day, slot) per instance where neither the teacher
      //   nor any of the lesson's classes are already occupied (D1/D2).

      const lessonUsedSlots       = new Map<string, Set<string>>()
      const occupiedTeacher       = new Set<string>()   // "teacherId:day:slot"
      const occupiedClass         = new Set<string>()   // "classId:day:slot"
      // Subset of occupiedClass: only slots taken by MATH_GROUP / ENGLISH_GROUP lessons.
      const groupOccupiedSlots    = new Set<string>()   // "classId:day:slot" — group lessons only
      // D7 tracking: "subjectId:classId:day"
      const subjectOnClassDay     = new Set<string>()
      // Specialized room saturation: "specializedRoomId:day:slot"
      // Prevents two lessons requiring the same lab/studio from landing on the same slot.
      const occupiedSpecializedRoom = new Set<string>()

      // Seed occupancy maps from fixed seed entries
      for (const se of entries) {
        const lesson = se.lesson
        if (!lesson) continue
        if (!lessonUsedSlots.has(se.lessonId)) lessonUsedSlots.set(se.lessonId, new Set())
        lessonUsedSlots.get(se.lessonId)!.add(`${se.day}:${se.slot}`)
        for (const tid of lessonTeacherIds(lesson)) {
          occupiedTeacher.add(`${tid}:${se.day}:${se.slot}`)
        }
        for (const cls of lesson.classes) {
          occupiedClass.add(`${cls.id}:${se.day}:${se.slot}`)
          subjectOnClassDay.add(`${lesson.subjectId}:${cls.id}:${se.day}`)
        }
        const specialRoomId = lesson.subject?.specializedRoomId
        if (specialRoomId) occupiedSpecializedRoom.add(`${specialRoomId}:${se.day}:${se.slot}`)
      }

      // All (day, slot) combos — shuffled fresh each restart for variety
      const allSlots: Array<{ day: string; slot: number }> = []
      for (const d of days) for (let s = 1; s <= slotsPerDay; s++) allSlots.push({ day: d, slot: s })

      // ── Phase A: synchronized group placement ─────────────────

      // Collect sync-group instances: Map key = "MATH_GROUP:gradeId" or "ENGLISH_GROUP:gradeId"
      const syncGroupMap = new Map<string, Array<{ lessonId: string; lesson: any }>>()
      const syncGroupLessonIds = new Set<string>()

      for (const inst of toPlace) {
        const { type, gradeId } = inst.lesson
        if ((type !== 'MATH_GROUP' && type !== 'ENGLISH_GROUP') || !gradeId) continue
        const key = `${type}:${gradeId}`
        if (!syncGroupMap.has(key)) syncGroupMap.set(key, [])
        syncGroupMap.get(key)!.push(inst)
        syncGroupLessonIds.add(inst.lessonId)
      }

      for (const [, groupInstances] of syncGroupMap) {
        // Distinct lessonIds in this group and their instances, in stable order
        const instancesByLesson = new Map<string, Array<{ lessonId: string; lesson: any }>>()
        for (const inst of groupInstances) {
          if (!instancesByLesson.has(inst.lessonId)) instancesByLesson.set(inst.lessonId, [])
          instancesByLesson.get(inst.lessonId)!.push(inst)
        }

        // Number of simultaneous slots needed = max hoursPerWeek in the group
        const requiredSlots = Math.max(...[...instancesByLesson.values()].map(v => v.length))

        // All teachers in this group (one per lesson)
        const groupTeachers = [...instancesByLesson.keys()].map(
          lid => instancesByLesson.get(lid)![0].lesson.teacherId,
        )

        // Classes shared by all lessons in the group (they're the same — both classes of the grade)
        const groupClasses: string[] = groupInstances[0].lesson.classes.map((c: any) => c.id)

        // Find `requiredSlots` simultaneous slots where every group teacher is free
        // and the shared classes aren't occupied by other (non-group) lessons.
        const groupSubjectId    = groupInstances[0].lesson.subjectId
        const groupSpecialRoomId = groupInstances[0]?.lesson?.subject?.specializedRoomId
        const candidateSlots = [...allSlots].sort(() => Math.random() - 0.5)
        const chosenSlots: Array<{ day: string; slot: number }> = []
        const chosenKeys  = new Set<string>()

        for (const { day, slot } of candidateSlots) {
          if (chosenSlots.length >= requiredSlots) break
          const key = `${day}:${slot}`
          if (chosenKeys.has(key)) continue
          // Hard teacher unavailability — never relaxed regardless of fallback tier
          if (groupTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue

          // All group teachers must be free
          if (groupTeachers.some(tid => occupiedTeacher.has(`${tid}:${day}:${slot}`))) continue

          // Classes must not be occupied by non-group lessons
          if (groupClasses.some(cid => occupiedClass.has(`${cid}:${day}:${slot}`))) continue

          // No same subject on the same day for any class in the group (D7)
          if (groupClasses.some(cid => subjectOnClassDay.has(`${groupSubjectId}:${cid}:${day}`))) continue

          // Specialized room must not already be claimed at this slot
          if (groupSpecialRoomId && occupiedSpecializedRoom.has(`${groupSpecialRoomId}:${day}:${slot}`)) continue

          chosenSlots.push({ day, slot })
          chosenKeys.add(key)
        }

        // Fallback tier 1: relax teacher/class checks but keep D7 and specialized-room guards.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const key = `${day}:${slot}`
            if (chosenKeys.has(key)) continue
            if (groupTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            if (groupClasses.some(cid => subjectOnClassDay.has(`${groupSubjectId}:${cid}:${day}`))) continue
            if (groupSpecialRoomId && occupiedSpecializedRoom.has(`${groupSpecialRoomId}:${day}:${slot}`)) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(key)
          }
        }

        // Fallback tier 2: relax teacher/class AND D7, but still guard specialized room.
        // A specialized-room conflict can never be fixed by local search — skip the slot entirely.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const key = `${day}:${slot}`
            if (chosenKeys.has(key)) continue
            if (groupTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            if (groupSpecialRoomId && occupiedSpecializedRoom.has(`${groupSpecialRoomId}:${day}:${slot}`)) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(key)
          }
        }

        // Fallback tier 3 (absolute last resort): any unused slot except hard-unavailable ones.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const key = `${day}:${slot}`
            if (chosenKeys.has(key)) continue
            if (groupTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(key)
          }
        }

        // Assign: instance[i] of every lesson → chosenSlots[i]  (keeps groups simultaneous)
        for (const [lessonId, lessonInstances] of instancesByLesson) {
          if (!lessonUsedSlots.has(lessonId)) lessonUsedSlots.set(lessonId, new Set())
          const usedByLesson = lessonUsedSlots.get(lessonId)!

          lessonInstances.forEach((inst, i) => {
            const { day, slot } = chosenSlots[Math.min(i, chosenSlots.length - 1)]
            usedByLesson.add(`${day}:${slot}`)
            entries.push({
              id: `gen-${lessonId}-${restart}-${Math.random()}`,
              lessonId,
              day,
              slot,
              roomId: null,
              isSeeded: false,
              overrides: [],
              lesson: inst.lesson,
            })
          })
        }

        // Mark chosen slots as occupied so regular lessons route around them
        for (const { day, slot } of chosenSlots) {
          for (const tid of groupTeachers) occupiedTeacher.add(`${tid}:${day}:${slot}`)
          for (const cid of groupClasses) {
            occupiedClass.add(`${cid}:${day}:${slot}`)
            groupOccupiedSlots.add(`${cid}:${day}:${slot}`)   // ← group-only tracking
            subjectOnClassDay.add(`${groupSubjectId}:${cid}:${day}`)  // ← D7 tracking
          }
          if (groupSpecialRoomId) occupiedSpecializedRoom.add(`${groupSpecialRoomId}:${day}:${slot}`)
        }
      }

      // ── Phase A': LESSON_GRADE_SYNC lessons ───────────────────
      //
      // Any lesson covered by a LESSON_GRADE_SYNC restriction must be placed at
      // the SAME (day, slot) as all other lessons for that (subject, grade) pair.
      // These are REGULAR lessons (each class has its own teacher/room) but the
      // school requires them to run in parallel (e.g. homeroom / חינוך).
      //
      // We place them all at a shared slot before Phase B so they start in sync.
      // The LESSON_GRADE_SYNC restriction (NON_NEGOTIABLE) then prevents local
      // search from splitting them up, since breaking sync raises hardCount.

      const gradeSyncLessonIds = new Set<string>()

      // Build (subjectId:gradeId) → restriction list
      const gradeSyncMap = new Map<string, any>()  // key → restriction
      for (const r of restrictions) {
        if (r.type !== 'LESSON_GRADE_SYNC' || !r.subjectId || !r.gradeId) continue
        gradeSyncMap.set(`${r.subjectId}:${r.gradeId}`, r)
      }

      for (const [key, r] of gradeSyncMap) {
        const [subjectId, gradeId] = key.split(':')

        // Find all REGULAR or PARALLEL instances for this subject whose class belongs to this grade
        const syncInstances = toPlace.filter(inst =>
          inst.lesson.subjectId === subjectId &&
          (inst.lesson.type === 'REGULAR' || inst.lesson.type === 'PARALLEL') &&
          inst.lesson.classes.some((c: any) => c.gradeId === gradeId),
        )
        if (syncInstances.length === 0) continue

        // Group by lesson
        const instancesByLesson = new Map<string, any[]>()
        for (const inst of syncInstances) {
          if (!instancesByLesson.has(inst.lessonId)) instancesByLesson.set(inst.lessonId, [])
          instancesByLesson.get(inst.lessonId)!.push(inst)
          gradeSyncLessonIds.add(inst.lessonId)
        }

        // Number of shared slots needed = max hoursPerWeek among matching lessons
        const requiredSlots = Math.max(...[...instancesByLesson.values()].map(v => v.length))

        // Collect all teachers and classes in this sync group
        // Use lessonTeacherIds to handle PARALLEL lessons (no primary teacherId)
        const syncTeacherSet = new Set<string>()
        for (const lid of instancesByLesson.keys()) {
          for (const tid of lessonTeacherIds(instancesByLesson.get(lid)![0].lesson)) {
            syncTeacherSet.add(tid)
          }
        }
        const syncTeachers = [...syncTeacherSet]
        const syncClasses: string[] = syncInstances.flatMap(inst =>
          inst.lesson.classes.map((c: any) => c.id),
        ).filter((id, i, arr) => arr.indexOf(id) === i)  // deduplicate

        // Find slots where every teacher AND every class is free
        const syncSubjectId    = syncInstances[0].lesson.subjectId
        const syncSpecialRoomId = syncInstances[0].lesson.subject?.specializedRoomId
        const candidateSlots = [...allSlots].sort(() => Math.random() - 0.5)
        const chosenSlots: Array<{ day: string; slot: number }> = []
        const chosenKeys  = new Set<string>()

        for (const { day, slot } of candidateSlots) {
          if (chosenSlots.length >= requiredSlots) break
          const slotKey = `${day}:${slot}`
          if (chosenKeys.has(slotKey)) continue
          // Hard teacher unavailability — never relaxed regardless of fallback tier
          if (syncTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
          if (syncTeachers.some(tid => occupiedTeacher.has(`${tid}:${day}:${slot}`))) continue
          if (syncClasses.some(cid => occupiedClass.has(`${cid}:${day}:${slot}`))) continue
          // No same subject on the same day for any sync class (D7)
          if (syncClasses.some(cid => subjectOnClassDay.has(`${syncSubjectId}:${cid}:${day}`))) continue
          // Specialized room must not already be claimed at this slot
          if (syncSpecialRoomId && occupiedSpecializedRoom.has(`${syncSpecialRoomId}:${day}:${slot}`)) continue
          chosenSlots.push({ day, slot })
          chosenKeys.add(slotKey)
        }

        // Fallback tier 1: relax teacher/class checks but keep D7 and specialized-room guards.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const slotKey = `${day}:${slot}`
            if (chosenKeys.has(slotKey)) continue
            if (syncTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            if (syncClasses.some(cid => subjectOnClassDay.has(`${syncSubjectId}:${cid}:${day}`))) continue
            if (syncSpecialRoomId && occupiedSpecializedRoom.has(`${syncSpecialRoomId}:${day}:${slot}`)) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(slotKey)
          }
        }

        // Fallback tier 2: relax teacher/class AND D7, but still guard specialized room.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const slotKey = `${day}:${slot}`
            if (chosenKeys.has(slotKey)) continue
            if (syncTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            if (syncSpecialRoomId && occupiedSpecializedRoom.has(`${syncSpecialRoomId}:${day}:${slot}`)) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(slotKey)
          }
        }

        // Fallback tier 3 (absolute last resort): any unused slot except hard-unavailable ones.
        if (chosenSlots.length < requiredSlots) {
          for (const { day, slot } of candidateSlots) {
            if (chosenSlots.length >= requiredSlots) break
            const slotKey = `${day}:${slot}`
            if (chosenKeys.has(slotKey)) continue
            if (syncTeachers.some(tid => isHardUnavailable(tid, day, slot, hardTeacherAvail))) continue
            chosenSlots.push({ day, slot })
            chosenKeys.add(slotKey)
          }
        }

        // Place all lessons at their shared slots
        for (const [lessonId, lessonInstances] of instancesByLesson) {
          if (!lessonUsedSlots.has(lessonId)) lessonUsedSlots.set(lessonId, new Set())
          const usedByLesson = lessonUsedSlots.get(lessonId)!

          lessonInstances.forEach((inst, i) => {
            const { day, slot } = chosenSlots[Math.min(i, chosenSlots.length - 1)]
            usedByLesson.add(`${day}:${slot}`)
            entries.push({
              id: `gen-${lessonId}-${restart}-${Math.random()}`,
              lessonId,
              day,
              slot,
              roomId: null,
              isSeeded: false,
              overrides: [],
              lesson: inst.lesson,
            })
          })
        }

        // Mark occupancy — each class is blocked at the chosen slots
        // (do NOT add to groupOccupiedSlots: students don't switch classes, so other
        //  regular lessons for OTHER classes are not affected by this slot choice)
        for (const { day, slot } of chosenSlots) {
          for (const tid of syncTeachers) occupiedTeacher.add(`${tid}:${day}:${slot}`)
          for (const cid of syncClasses) {
            occupiedClass.add(`${cid}:${day}:${slot}`)
            subjectOnClassDay.add(`${syncSubjectId}:${cid}:${day}`)  // ← D7 tracking
          }
          if (syncSpecialRoomId) occupiedSpecializedRoom.add(`${syncSpecialRoomId}:${day}:${slot}`)
        }
      }

      // ── Phase B: backtracking CSP placement ──────────────────
      //
      // Replace the old greedy random placement with a proper constraint-
      // satisfaction search.  The backtracker guarantees zero hard-invariant
      // violations (D1/D2/D7) in the initial placement so local search starts
      // from a clean state every time.
      //
      // If backtracking fails (infeasible or timed out) this restart is skipped.
      // Tracking across restarts tells us whether the problem is provably
      // infeasible or merely hard for a particular random ordering.

      const remaining = toPlace.filter(inst =>
        !syncGroupLessonIds.has(inst.lessonId) && !gradeSyncLessonIds.has(inst.lessonId),
      )

      // Build count-map occupancy from Phase A/A' Sets.
      const initOcc: BacktrackOcc = {
        teacherSlot: new Map([...occupiedTeacher].map(k => [k, 1])),
        classSlot:   new Map([...occupiedClass].map(k => [k, 1])),
        lessonAtSlot: new Map(
          [...lessonUsedSlots.entries()].flatMap(([lid, slots]) =>
            [...slots].map(s => [`${lid}:${s}`, 1]),
          ),
        ),
        subjectClassDay:     new Map([...subjectOnClassDay].map(k => [k, 1])),
        specializedRoomSlot: new Map([...occupiedSpecializedRoom].map(k => [k, 1])),
        groupClassSlot:      groupOccupiedSlots,
      }

      // Pre-shuffle so equal-MRV-count lessons vary across restarts.
      const shuffledRemaining = fisherYates([...remaining])
      patchJob(input.jobId, { statusMessage: `Restart ${restart + 1}/${input.nRestarts} — backtracking (${remaining.length} lessons)…` })
      const deadline = Date.now() + BACKTRACK_TIMEOUT_MS
      const btResult = backtrackPhaseB(shuffledRemaining, initOcc, allSlots, deadline, restart, hardTeacherAvail, softLookup)

      if (!btResult.ok) {
        const reason = btResult.timedOut ? 'timed out' : 'proved infeasible'
        patchJob(input.jobId, { statusMessage: `Restart ${restart + 1}/${input.nRestarts} — skipped (${reason})` })
        console.log(`[AutoScheduler] Restart ${String(restart + 1).padStart(2)}: backtracking ${reason} — skipping`)
        if (!btResult.timedOut) nInfeasibleRestarts++
        nSkippedRestarts++
        continue  // skip local search for this restart
      }

      patchJob(input.jobId, { statusMessage: `Restart ${restart + 1}/${input.nRestarts} — optimizing (${input.nIterations.toLocaleString()} steps)…` })

      entries.push(...btResult.entries)

      // ── Phase A duplicate guard ────────────────────────────────────
      // Phase A uses a Math.min(i, last) fallback when INVARIANT restrictions
      // leave fewer available slots than a group lesson needs.  This stacks
      // multiple instances at the same (lessonId, day, slot), which local search
      // cannot fix (Guard 1 only rejects candidates that ADD new duplicates, not
      // existing ones).  deduplicateLessonSlots would later relocate them to
      // arbitrary slots without checking teacher/class occupancy, producing D1/D2
      // violations that cause Gate 2 to reject all candidates.
      //
      // Detect this condition early and skip the restart.  Counting as a "timed out"
      // restart ensures the user gets a meaningful error message about tight
      // constraints rather than the opaque "algorithmic bug" text.
      if (hasDuplicateLessonSlots(entries)) {
        console.log(
          `[AutoScheduler] Restart ${String(restart + 1).padStart(2)}: Phase A created duplicate` +
          ` lesson placements (insufficient valid slots after INVARIANT restrictions) — skipping`,
        )
        nSkippedRestarts++
        continue
      }

      // Sync the Phase-A/A' occupancy Sets with the backtracking result so
      // local search (which uses the Sets directly) sees a consistent state.
      for (const e of btResult.entries) {
        const lesson = e.lesson
        if (!lessonUsedSlots.has(e.lessonId)) lessonUsedSlots.set(e.lessonId, new Set())
        lessonUsedSlots.get(e.lessonId)!.add(`${e.day}:${e.slot}`)
        for (const tid of lessonTeacherIds(lesson)) occupiedTeacher.add(`${tid}:${e.day}:${e.slot}`)
        for (const cls of lesson.classes) {
          occupiedClass.add(`${cls.id}:${e.day}:${e.slot}`)
          subjectOnClassDay.add(`${lesson.subjectId}:${cls.id}:${e.day}`)
        }
        const specialRoomId = lesson.subject?.specializedRoomId
        if (specialRoomId) occupiedSpecializedRoom.add(`${specialRoomId}:${e.day}:${e.slot}`)
      }

      // Step 3: Local search — lexicographic hill climbing.
      //
      // Three-level acceptance criterion (in priority order):
      //   1. Fewer CLASS_DOUBLE_BOOKED violations  →  always accept
      //      (class conflicts are a physical impossibility and take strict priority)
      //   2. Fewer other NON_NEGOTIABLE violations →  accept when level 1 is tied
      //   3. Lower total penalty score             →  accept when levels 1+2 are tied
      //
      // Additionally, two candidate-rejection guards run BEFORE scoring:
      //   • hasDuplicateLessonSlots  — prevents the DB unique constraint from firing
      //   • hasRegularAtGroupSlot    — absolute invariant: no student can be in a
      //     regular class and a level-group class simultaneously
      //
      // CLASS_DOUBLE_BOOKED and LESSON_GRADE_SYNC are tracked independently of the
      // general hardCount so local search can never trade either of those violations
      // for any other hard violation even when the net hardCount stays the same.
      // Phase A' ensures grade-sync lessons start in sync; this guard keeps them there.
      const evalCurrent = () => evaluate({
        entries,
        lessons,
        restrictions,
        config: evalConfig,
        overrides: [],
        // Rooms are not assigned during local search (all roomId = null).
        // Skipping room checks avoids phantom SPECIALIZED_ROOM_VIOLATED violations
        // that would otherwise pollute the invariant count and block the invariant gate.
        skipRoomCheck: true,
      })
      const countClassConflicts = (r: any): number =>
        r.violations.filter((v: any) => v.restrictionType === 'CLASS_DOUBLE_BOOKED' && !v.isOverridden).length
      const countGradeSyncConflicts = (r: any): number =>
        r.violations.filter((v: any) => v.restrictionType === 'LESSON_GRADE_SYNC' && !v.isOverridden).length

      // Seeded entry ID set — stable throughout local search (seeded entries never move).
      // Used to exclude seeded-only violations from the hard-violation count so that
      // manually accepted conflicts in the seed don't inflate hardCount and distort SA.
      const localSeededIds = new Set(entries.filter((e: any) => e.isSeeded).map((e: any) => e.id))

      // compositeHard: INVARIANT violations take absolute priority over NON_NEGOTIABLE.
      // Multiplying invariant count by 10 000 ensures any increase in invariants
      // always outweighs any reduction in non-negotiable violations, so local search
      // can never trade an invariant for a non-negotiable improvement.
      // Seeded-only violations are excluded — they are user-accepted and the AS cannot
      // change them (seeded entries are immovable anchors).
      const compositeHard = (r: any) => {
        const adjustedInvariants = (r.violations as any[])
          .filter((v: any) => v.tier === 'INVARIANT' && !v.isOverridden && !isSeededOnlyViolation(v, localSeededIds))
          .length
        return adjustedInvariants * 10_000 + r.counts.nonNegotiable
      }

      let evalResult        = evalCurrent()
      let score             = evalResult.score
      let hardCount         = compositeHard(evalResult)
      let classConflicts    = countClassConflicts(evalResult)
      let gradeSyncConflicts = countGradeSyncConflicts(evalResult)
      // Guard 5 baseline: specialized-room slot conflicts (pre-room-assignment conflicts
      // that assignRooms() cannot fix because it can only give a room to one lesson).
      let specialRoomConflicts = countSpecialRoomConflicts(entries)

      // ── Simulated annealing cooling schedule ──────────────────
      // SA is applied to the SOFT score dimension only (when hardCount is unchanged).
      // This lets local search escape local optima that pure hill-climbing gets stuck in.
      //
      // T₀ = 50,000 → P(accept one NON_NEGOTIABLE violation, +100K) ≈ 13% at start.
      // T_final = 1  → only sub-FLEXIBLE improvements accepted at the very end.
      // Cooling: geometric over nIterations iterations.
      const SA_T0 = 50_000
      const SA_T_FINAL = 1

      for (let iter = 0; iter < input.nIterations; iter++) {
        const nonSeeded = entries.filter((e: any) => !e.isSeeded)
        if (nonSeeded.length < 2) break

        let candidate: any[]

        if (Math.random() < 0.7) {
          // Swap: exchange (day, slot) of two random non-seeded entries
          const i = Math.floor(Math.random() * nonSeeded.length)
          let j = Math.floor(Math.random() * nonSeeded.length)
          if (i === j) continue
          const a = nonSeeded[i]
          const b = nonSeeded[j]
          candidate = entries.map((e: any) => {
            if (e.id === a.id) return { ...e, day: b.day, slot: b.slot }
            if (e.id === b.id) return { ...e, day: a.day, slot: a.slot }
            return e
          })
        } else {
          // Move: reassign one entry to a random (day, slot)
          const idx = Math.floor(Math.random() * nonSeeded.length)
          const entry = nonSeeded[idx]
          const newDay  = days[Math.floor(Math.random() * days.length)]
          const newSlot = Math.floor(Math.random() * slotsPerDay) + 1
          candidate = entries.map((e: any) =>
            e.id === entry.id ? { ...e, day: newDay, slot: newSlot } : e,
          )
        }

        // Guard 1: same lesson must never occupy the same slot twice (DB constraint)
        if (hasDuplicateLessonSlots(candidate)) continue

        // Guard 2: no REGULAR/SHARED lesson may share a (class, day, slot) with a
        // group lesson — absolute invariant regardless of score impact
        if (hasRegularAtGroupSlot(candidate)) continue

        const cResult              = evaluate({ entries: candidate, lessons, restrictions, config: evalConfig, overrides: [], skipRoomCheck: true })
        const cHard                = compositeHard(cResult)
        const cScore               = cResult.score
        const cClassConflicts      = countClassConflicts(cResult)
        const cGradeSyncConflicts  = countGradeSyncConflicts(cResult)
        const cSpecialRoomConflicts = countSpecialRoomConflicts(candidate)

        // Guard 3: class conflicts must never increase — not even if other violations improve
        if (cClassConflicts > classConflicts) continue
        // Guard 4: grade-sync violations must never increase — sync set up by Phase A' is preserved
        if (cGradeSyncConflicts > gradeSyncConflicts) continue
        // Guard 5: specialized-room slot conflicts must never increase — assignRooms() can only
        // give a specialized room to one lesson per slot; a conflict is a permanent quality problem.
        if (cSpecialRoomConflicts > specialRoomConflicts) continue

        // Simulated-annealing acceptance for the soft-score dimension.
        // When hardCount is unchanged, SA allows uphill moves with probability
        // exp(-Δscore / T) where T cools geometrically from SA_T0 to SA_T_FINAL.
        const T = SA_T0 * Math.pow(SA_T_FINAL / SA_T0, iter / Math.max(input.nIterations, 1))
        const fewerClass = cClassConflicts < classConflicts
        const betterHard = cHard < hardCount
        const sameHard   = cHard === hardCount &&
          (cScore <= score || Math.random() < Math.exp(-(cScore - score) / T))

        if (fewerClass || betterHard || sameHard) {
          entries               = candidate
          score                 = cScore
          hardCount             = cHard
          classConflicts        = cClassConflicts
          gradeSyncConflicts    = cGradeSyncConflicts
          specialRoomConflicts  = cSpecialRoomConflicts
          evalResult            = cResult   // keep evalResult current so post-loop checks are accurate
        }
      }

      // Count hard INVARIANT-tier violations in this restart's result.
      // Exclude seeded-only violations from the ranking invariant count so candidates
      // with accepted seed violations rank on the same footing as clean ones.
      const invariantCount = (evalResult.violations as any[])
        .filter((v: any) => v.tier === 'INVARIANT' && !v.isOverridden && !isSeededOnlyViolation(v, localSeededIds))
        .length

      // ── All-lessons-placed check (per restart) ──────────────────────
      // Verify every instance that was in toPlace has a corresponding
      // non-seeded entry.  The backtracking solver guarantees this for Phase B,
      // but Phase A/A' can produce duplicate (lessonId, day, slot) pairs in
      // degenerate configs (hoursPerWeek > available simultaneous slots), which
      // would leave some instances displaced.  Catch it before saving.
      {
        const expectedPerLesson = new Map<string, number>()
        for (const inst of toPlace) {
          expectedPerLesson.set(inst.lessonId, (expectedPerLesson.get(inst.lessonId) ?? 0) + 1)
        }
        const actualPerLesson = new Map<string, number>()
        for (const e of entries) {
          if (!e.isSeeded) actualPerLesson.set(e.lessonId, (actualPerLesson.get(e.lessonId) ?? 0) + 1)
        }
        let restartAllPlaced = true
        for (const [lessonId, expected] of expectedPerLesson) {
          const actual = actualPerLesson.get(lessonId) ?? 0
          if (actual < expected) {
            console.warn(`[AutoScheduler] Restart ${restart + 1}: lesson ${lessonId.slice(-6)} placed ${actual}/${expected} instances — skipping restart`)
            restartAllPlaced = false
            nSkippedRestarts++
            break
          }
        }
        if (!restartAllPlaced) continue
      }

      // Insert this restart's result into the top-3 list
      const c: Candidate = { entries, score, hardCount, classConflicts, gradeSyncConflicts, invariantCount }
      if (!bestCandidate || isBetterCandidate(c, bestCandidate)) bestCandidate = c

      // Per-restart diagnostic log
      const b = bestCandidate
      console.log(
        `[AutoScheduler] Restart ${String(restart + 1).padStart(2)}/${input.nRestarts}` +
        ` | inv=${invariantCount}` +
        ` | classConflicts=${classConflicts}` +
        ` | gradeSync=${gradeSyncConflicts}` +
        ` | nonNeg=${evalResult.counts.nonNegotiable}` +
        ` | score=${score}` +
        ` | best(inv=${b.invariantCount} cc=${b.classConflicts} gs=${b.gradeSyncConflicts} h=${b.hardCount} s=${b.score})`
      )

      // Update progress, yield to event loop so the poll request can read the new state.
      patchJob(input.jobId, { progress: Math.round(((restart + 1) / input.nRestarts) * 95) })
      await new Promise<void>(resolve => setImmediate(resolve))
    }

    console.log(`[AutoScheduler] ─── DONE ───────────────────────────────`)
    if (bestCandidate) {
      const b0 = bestCandidate
      console.log(`[AutoScheduler] Best: inv=${b0.invariantCount} cc=${b0.classConflicts} gs=${b0.gradeSyncConflicts} h=${b0.hardCount} s=${b0.score}`)
    }
    console.log(`[AutoScheduler] ═══════════════════════════════════════\n`)

    // ── Gate 1: all restarts were skipped — backtracking never found a valid start ──
    if (nSkippedRestarts === input.nRestarts) {
      const totalSlots = slotsPerDay * days.length
      let error: string
      if (nInfeasibleRestarts === input.nRestarts) {
        error =
          `The schedule is provably infeasible: the backtracking solver exhausted all ` +
          `possibilities across all ${input.nRestarts} restarts without finding a valid ` +
          `placement. This means it is mathematically impossible to assign all lessons ` +
          `without hard constraint violations given the current data. ` +
          `Check: (1) no class exceeds ${totalSlots} hours/week ` +
          `(${slotsPerDay} slots/day × ${days.length} days), ` +
          `(2) no teacher is over-allocated, (3) group-lesson slots don't block too many regular lessons.`
      } else {
        error =
          `The auto-scheduler could not find a valid placement in ${input.nRestarts} restarts ` +
          `(${nInfeasibleRestarts} proved infeasible, ${nSkippedRestarts - nInfeasibleRestarts} timed out after ${BACKTRACK_TIMEOUT_MS / 1000}s). ` +
          `The schedule may be infeasible or extremely tightly constrained. ` +
          `Try: reducing total lesson hours, increasing slots/day in School Config, ` +
          `or running more restarts.`
      }
      jobs.set(input.jobId, { jobId: input.jobId, status: 'ERROR', progress: 100, error })
      return
    }

    // ── Finalization: dedup → assign rooms → Gate 3 → Gate 2 → full eval → save ──
    const lessonMap = new Map(lessons.map((l: any) => [l.id, l]))
    patchJob(input.jobId, { statusMessage: 'Finalizing…', progress: 97 })

    const deduped   = deduplicateLessonSlots(bestCandidate!.entries, days, slotsPerDay)
    const withRooms = assignRooms(deduped, lessons, rooms)
    const enriched  = withRooms.map((e: any) => ({
      ...e,
      lesson:    e.lesson ?? lessonMap.get(e.lessonId),
      overrides: e.overrides ?? [],
    })).filter((e: any) => e.lesson)

    // ── Gate 3: all lessons must have all hours placed ──────────────
    {
      const placedCounts = new Map<string, number>()
      for (const e of enriched) {
        placedCounts.set(e.lessonId, (placedCounts.get(e.lessonId) ?? 0) + 1)
      }
      const missingLessons: string[] = []
      for (const l of lessons) {
        const actual   = placedCounts.get(l.id) ?? 0
        const expected = l.hoursPerWeek
        if (actual < expected) {
          const name = (l as any).subject?.name ?? l.id.slice(-6)
          missingLessons.push(`"${name}" (${actual}/${expected} hrs)`)
        }
      }
      if (missingLessons.length > 0) {
        const preview = missingLessons.slice(0, 5).join(', ') + (missingLessons.length > 5 ? ` +${missingLessons.length - 5} more` : '')
        console.warn(`[AutoScheduler] Failed Gate 3 (unplaced lessons): ${preview}`)
        const totalSlots = slotsPerDay * days.length
        jobs.set(input.jobId, { jobId: input.jobId, status: 'ERROR', progress: 100,
          error: `The auto-scheduler could not place all lessons. ` +
            `This usually means total lesson hours for one or more classes exceed the available ` +
            `slot budget (${slotsPerDay} slots/day × ${days.length} days = ${totalSlots} slots/class). ` +
            `Fix: reduce lesson hours per class, increase "Slots per day" in School Config, ` +
            `or add more working days.`,
        })
        return
      }
    }

    // ── Gate 2: only physical impossibilities block here ──
    // Seeded-only violations are excluded (user-accepted anchors).
    // CLASS_SUBJECT_TWICE_PER_DAY (D7) is intentionally excluded from blocking:
    // it is a *quality* issue, not a physical impossibility.  With very tight
    // constraints (100% class capacity + many INVARIANT teacher blocks) Phase A
    // sometimes cannot avoid placing a group lesson on a day that creates a D7
    // conflict — discarding the entire schedule in that case is worse than saving
    // it with the violation visible in the editor where it can be manually fixed.
    // D7 violations still appear in the full evaluation so the user can see them.
    const GATE2_BLOCKING_TYPES = new Set([
      'TEACHER_DOUBLE_BOOKED',   // D1 — teacher physically in two places
      'CLASS_DOUBLE_BOOKED',     // D2 — class physically in two places
      'LESSON_GRADE_SYNC',       // D3/D4 — math/english groups out of sync
    ])

    const gateEval = evaluate({
      entries: enriched as any, lessons: lessons as any,
      restrictions: [], config: evalConfig, overrides: [],
    })
    const gate2SeededIds = new Set(enriched.filter((e: any) => e.isSeeded).map((e: any) => e.id))
    const gate2Blocked = gateEval.violations.filter(
      (v: any) => v.tier === 'INVARIANT'
        && !v.isOverridden
        && !isSeededOnlyViolation(v, gate2SeededIds)
        && GATE2_BLOCKING_TYPES.has(String(v.restrictionType))
    )
    if (gate2Blocked.length > 0) {
      const breakdown = gate2Blocked
        .reduce((m: Map<string,number>, v: any) => {
          const t = String(v.restrictionType); m.set(t, (m.get(t) ?? 0) + 1); return m
        }, new Map<string,number>())
      const detail = [...breakdown.entries()].map(([t,n]) => `${t}×${n}`).join(', ')
      console.warn(`[AutoScheduler] Failed Gate 2 (${detail})`)
      jobs.set(input.jobId, { jobId: input.jobId, status: 'ERROR', progress: 100,
        error: `The auto-scheduler produced a schedule with unresolvable double-bookings ` +
          `(${detail}). This is usually caused by group lessons (Math/English) ` +
          `having too few available time slots due to INVARIANT teacher restrictions. ` +
          `Try: (1) reducing INVARIANT availability blocks in Restrictions → Teachers, ` +
          `(2) increasing "Slots per day" in School Config, ` +
          `(3) running with more restarts.`,
      })
      return
    }
    // Log any non-blocking Gate 2 violations (D7 or seeded-only) for observability
    const nonBlockingInvariants = gateEval.violations.filter(
      (v: any) => v.tier === 'INVARIANT' && !v.isOverridden
        && (!GATE2_BLOCKING_TYPES.has(String(v.restrictionType)) || isSeededOnlyViolation(v, gate2SeededIds))
    )
    if (nonBlockingInvariants.length > 0) {
      const breakdown = nonBlockingInvariants
        .reduce((m: Map<string,number>, v: any) => {
          const t = String(v.restrictionType); m.set(t, (m.get(t) ?? 0) + 1); return m
        }, new Map<string,number>())
      console.log(`[AutoScheduler] Gate 2 passed (non-blocking violations: ${[...breakdown.entries()].map(([t,n]) => `${t}×${n}`).join(', ')})`)
    }

    const fullEval = evaluate({
      entries: enriched as any, lessons: lessons as any,
      restrictions: restrictions as any, config: evalConfig, overrides: [],
    })

    patchJob(input.jobId, { statusMessage: 'Saving schedule…', progress: 99 })
    const schedule = await prisma.schedule.create({
      data: {
        name:  input.name,
        state: 'DRAFT',
        entries: {
          create: withRooms.map((e: any) => ({
            lessonId: e.lessonId,
            day:      e.day,
            slot:     e.slot,
            roomId:   e.roomId  ?? null,
            roomId2:  e.roomId2 ?? null,
            isSeeded: e.isSeeded ?? false,
          })),
        },
      },
    })
    console.log(`[AutoScheduler] Saved "${input.name}": nonNeg=${fullEval.counts.nonNegotiable} imp=${fullEval.counts.important} score=${fullEval.score}`)

    const savedCandidate: CandidateResult = {
      scheduleId: schedule.id,
      name:       input.name,
      score:      fullEval.score,
      violations: {
        total:         fullEval.counts.total,
        nonNegotiable: fullEval.counts.nonNegotiable,
        important:     fullEval.counts.important,
        preferred:     fullEval.counts.preferred,
        flexible:      fullEval.counts.flexible,
      },
    }
    const savedCandidates = [savedCandidate]

    jobs.set(input.jobId, {
      jobId:      input.jobId,
      status:     'DONE',
      progress:   100,
      candidates: savedCandidates,
      scheduleId: savedCandidates[0].scheduleId,  // convenience for any legacy callers
    })
  } catch (err: any) {
    console.error('[AutoScheduler] Job failed:', err)
    jobs.set(input.jobId, {
      jobId: input.jobId,
      status: 'ERROR',
      progress: 0,
      error: err?.message ?? 'Unknown error',
    })
  }
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Returns all teacher IDs associated with a lesson.
 * For REGULAR/SHARED/MATH_GROUP/ENGLISH_GROUP: just lesson.teacherId.
 * For PARALLEL/MULTI_TEACHER: the lessonTeachers array (teacherId is null).
 */
function lessonTeacherIds(lesson: any): string[] {
  const ids: string[] = []
  if (lesson.teacherId) ids.push(lesson.teacherId)
  for (const lt of lesson.lessonTeachers ?? []) {
    if (lt.teacherId && !ids.includes(lt.teacherId)) ids.push(lt.teacherId)
  }
  return ids
}

function expandLessons(lessons: any[]): Array<{ lessonId: string; lesson: any }> {
  const instances: Array<{ lessonId: string; lesson: any }> = []
  for (const lesson of lessons) {
    for (let i = 0; i < lesson.hoursPerWeek; i++) {
      instances.push({ lessonId: lesson.id, lesson })
    }
  }
  return instances
}

/**
 * Returns true if any REGULAR or SHARED lesson shares a (classId, day, slot) with a
 * MATH_GROUP or ENGLISH_GROUP lesson.  This is an absolute invariant: during a group
 * period ALL students in the grade are distributed across level groups — no student
 * can simultaneously be in a regular class.  We enforce this in candidate generation
 * (not just via the evaluator) so the local search can never drift into or maintain
 * such states even when doing so would numerically reduce the violation count.
 */
function hasRegularAtGroupSlot(entries: any[]): boolean {
  // Collect group-occupied (classId:day:slot) keys
  const groupKeys = new Set<string>()
  for (const e of entries) {
    if (e.lesson.type === 'MATH_GROUP' || e.lesson.type === 'ENGLISH_GROUP') {
      for (const cls of e.lesson.classes) {
        groupKeys.add(`${cls.id}:${e.day}:${e.slot}`)
      }
    }
  }
  if (groupKeys.size === 0) return false

  // Check whether any regular/shared/parallel/multi-teacher entry lands on a group slot for the same class
  for (const e of entries) {
    if (!['REGULAR', 'SHARED', 'PARALLEL', 'MULTI_TEACHER'].includes(e.lesson.type)) continue
    for (const cls of e.lesson.classes) {
      if (groupKeys.has(`${cls.id}:${e.day}:${e.slot}`)) return true
    }
  }
  return false
}

/**
 * Returns true if any two entries share the same (lessonId, day, slot) —
 * which would violate the DB unique constraint and produce a bad schedule.
 */
function hasDuplicateLessonSlots(entries: any[]): boolean {
  const seen = new Set<string>()
  for (const e of entries) {
    const key = `${e.lessonId}:${e.day}:${e.slot}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Remove (lessonId, day, slot) duplicates by moving conflicting entries to
 * the first free slot available for that lesson.  Called as a safety net
 * before persisting so we never hit the DB unique constraint.
 */
function deduplicateLessonSlots(entries: any[], days: string[], slotsPerDay: number): any[] {
  const seen = new Set<string>()
  const result: any[] = []

  for (const e of entries) {
    const key = `${e.lessonId}:${e.day}:${e.slot}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(e)
    } else {
      // Find the first free slot for this lesson
      let placed = false
      outer: for (const day of days) {
        for (let slot = 1; slot <= slotsPerDay; slot++) {
          const newKey = `${e.lessonId}:${day}:${slot}`
          if (!seen.has(newKey)) {
            seen.add(newKey)
            result.push({ ...e, day, slot })
            placed = true
            break outer
          }
        }
      }
      if (!placed) {
        // hoursPerWeek exceeds available slots — keep entry as-is (admin must resolve)
        result.push(e)
      }
    }
  }

  return result
}

/**
 * Assign rooms to entries greedily, per (day, slot) group.
 *
 * Priority order within each slot:
 *   1. Seeded entries already have roomIds — keep them, mark their room used.
 *   2. Entries whose subject has a specializedRoomId get that room (if free).
 *   3. All remaining entries get the first unused general room.
 *
 * If there are more entries than rooms in a slot some entries stay roomless —
 * the admin can assign them manually via the LessonCard room badge.
 */
function assignRooms(entries: any[], lessons: any[], rooms: any[]): any[] {
  // Build a map from lessonId to its subject for quick lookup
  const lessonMap = new Map<string, any>()
  for (const l of lessons) lessonMap.set(l.id, l)

  // Group entry indices by (day, slot)
  const slotGroups = new Map<string, number[]>()
  entries.forEach((e, idx) => {
    const key = `${e.day}:${e.slot}`
    if (!slotGroups.has(key)) slotGroups.set(key, [])
    slotGroups.get(key)!.push(idx)
  })

  const result = entries.map(e => ({ ...e }))

  for (const indices of slotGroups.values()) {
    const usedRoomIds = new Set<string>()

    // Pass 1: record rooms already assigned (primary and secondary) so we don't double-assign
    for (const idx of indices) {
      const e = result[idx]
      if (e.roomId)  usedRoomIds.add(e.roomId)
      if (e.roomId2) usedRoomIds.add(e.roomId2)
    }

    // Pass 2: give specialized rooms to entries that need them
    for (const idx of indices) {
      const e = result[idx]
      if (e.roomId) continue  // already set (seeded)
      const lesson = lessonMap.get(e.lessonId)
      if (lesson?.subject?.noRoomRequired) continue  // no room wanted
      const specialId = lesson?.subject?.specializedRoomId
      if (specialId && !usedRoomIds.has(specialId)) {
        result[idx].roomId = specialId
        usedRoomIds.add(specialId)
      }
    }

    // Pass 3: assign any remaining free room to entries still without one.
    // Skip subjects that explicitly don't need a room (e.g. PE outdoors).
    // Also filter rooms based on:
    //   - lesson's allowSmallRoom flag (small rooms only if allowed)
    //   - lesson's subject isArts flag (art rooms only for art subjects)
    for (const idx of indices) {
      const e = result[idx]
      if (e.roomId) continue
      const lesson = lessonMap.get(e.lessonId)
      if (lesson?.subject?.noRoomRequired) continue  // intentionally roomless
      const isArtSubject = lesson?.subject?.isArts ?? false
      // Filter available rooms by constraints:
      // - skip small rooms unless the lesson allows them
      // - skip art rooms unless the subject is arts
      const freeRoom = rooms.find((r: any) =>
        !usedRoomIds.has(r.id) &&
        (lesson?.allowSmallRoom || !r.isSmall) &&
        (isArtSubject || !r.isArtRoom)
      )
      if (freeRoom) {
        result[idx].roomId = freeRoom.id
        usedRoomIds.add(freeRoom.id)
      }
    }
  }

  return result
}

// ─── Backtracking CSP solver (Phase B replacement) ────────────
//
// Guarantees the initial placement has zero hard-invariant violations.
// Uses:
//   - MRV ordering (most-constrained lesson first)
//   - Forward checking (prune when any remaining lesson has 0 valid slots)
//   - Per-restart slot-order shuffle (exploration variety)
//   - Per-restart deadline (skips timed-out restarts instead of hanging)
//
// Solvable school instances typically complete in < 1 s.
// Provably infeasible instances fail almost instantly via forward checking.

const BACKTRACK_TIMEOUT_MS = 8_000  // 8 s per restart — increased from 3 s because INVARIANT teacher
// restrictions reduce the valid slot count and legitimately require deeper search.

// ─── Soft-constraint value-ordering helpers ───────────────────
//
// These are used by the backtracker to sort candidate slots by how many
// soft constraints they would violate, so the CSP starts from a placement
// that is already close to respecting teacher availability rather than a
// purely random one.  This dramatically reduces the NN violation count
// in the initial state, giving simulated annealing a much shorter path
// to a high-quality schedule.

/** Per-teacher soft-constraint penalty lookup. */
interface SoftLookup {
  teacherDay:     Map<string, Map<string, number>>   // teacherId → day     → weight
  teacherDaySlot: Map<string, Map<string, number>>   // teacherId → "d:s"   → weight
  teacherSlot:    Map<string, Map<number,  number>>  // teacherId → slot    → weight
}

function _addW2(outer: Map<string, Map<string, number>>, k1: string, k2: string, w: number): void {
  if (!outer.has(k1)) outer.set(k1, new Map())
  const inner = outer.get(k1)!
  inner.set(k2, (inner.get(k2) ?? 0) + w)
}
function _addWN(outer: Map<string, Map<number, number>>, k1: string, k2: number, w: number): void {
  if (!outer.has(k1)) outer.set(k1, new Map())
  const inner = outer.get(k1)!
  inner.set(k2, (inner.get(k2) ?? 0) + w)
}

/**
 * Build a soft-constraint penalty lookup from active restrictions.
 *
 * Tier weights: NON_NEGOTIABLE=1000, IMPORTANT=100, PREFERRED=10, FLEXIBLE=1.
 * INVARIANT restrictions are already hard-rejected in btValid — no weight needed here.
 *
 * Covers only teacher availability types (A1/A2/A3) because those are the primary
 * source of initial NN violations in the backtracker's random starting solution.
 */
function buildSoftLookup(restrictions: any[]): SoftLookup {
  const WEIGHT: Record<string, number> = {
    NON_NEGOTIABLE: 1000,
    IMPORTANT:      100,
    PREFERRED:      10,
    FLEXIBLE:       1,
  }
  const teacherDay     = new Map<string, Map<string, number>>()
  const teacherDaySlot = new Map<string, Map<string, number>>()
  const teacherSlot    = new Map<string, Map<number,  number>>()

  for (const r of restrictions) {
    if (!(r as any).teacherId || !(r as any).isActive) continue
    const w = WEIGHT[(r as any).tier] ?? 0
    if (w === 0) continue  // INVARIANT handled separately
    const p   = (r as any).params as any
    const tid = (r as any).teacherId as string
    if      ((r as any).type === 'TEACHER_UNAVAILABLE_DAY'       && p.day)                    _addW2(teacherDay,     tid, p.day,             w)
    else if ((r as any).type === 'TEACHER_UNAVAILABLE_DAY_SLOT'   && p.day && p.slot != null) _addW2(teacherDaySlot, tid, `${p.day}:${p.slot}`, w)
    else if ((r as any).type === 'TEACHER_UNAVAILABLE_SLOT'       && p.slot != null)          _addWN(teacherSlot,    tid, p.slot,            w)
  }
  return { teacherDay, teacherDaySlot, teacherSlot }
}

/** Compute the total soft-constraint penalty for placing teacher(s) tids at (day, slot). */
function slotSoftPenalty(
  tids: string[], day: string, slot: number,
  soft: SoftLookup,
): number {
  let pen = 0
  for (const tid of tids) {
    pen += soft.teacherDay.get(tid)?.get(day)                  ?? 0
    pen += soft.teacherDaySlot.get(tid)?.get(`${day}:${slot}`) ?? 0
    pen += soft.teacherSlot.get(tid)?.get(slot)                ?? 0
  }
  return pen
}

/** Count-map occupancy for exact undo during backtracking. */
interface BacktrackOcc {
  teacherSlot:       Map<string, number>  // "tid:day:slot"    → refcount
  classSlot:         Map<string, number>  // "cid:day:slot"    → refcount
  lessonAtSlot:      Map<string, number>  // "lid:day:slot"    → refcount (no same-lesson dupe)
  subjectClassDay:   Map<string, number>  // "sid:cid:day"     → refcount (D7)
  specializedRoomSlot: Map<string, number> // "roomId:day:slot" → refcount (specialized room saturation)
  groupClassSlot:    Set<string>          // Phase-A slots — immutable during backtrack
}

/** Hard teacher unavailability derived from INVARIANT-tier restrictions. */
interface HardAvail {
  days:     Set<string>   // Days teacher cannot work (any slot)
  daySlots: Set<string>   // "Day:slot" pairs teacher cannot work
  slots:    Set<number>   // Slot numbers teacher cannot teach on any day
}

/** Returns true when teacher tid is hard-unavailable (INVARIANT tier) at (day, slot). */
function isHardUnavailable(
  tid: string, day: string, slot: number,
  hardAvail: Map<string, HardAvail>,
): boolean {
  const ha = hardAvail.get(tid)
  if (!ha) return false
  return ha.days.has(day) || ha.daySlots.has(`${day}:${slot}`) || ha.slots.has(slot)
}

/**
 * Guard 5 helper: counts entries where two lessons needing the same specializedRoom
 * land at the same (day, slot).  Used during local search to prevent swaps from
 * re-introducing room conflicts that assignRooms() would fail to resolve.
 */
function countSpecialRoomConflicts(entries: any[]): number {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const rid = e.lesson?.subject?.specializedRoomId
    if (!rid) continue
    const k = `${rid}:${e.day}:${e.slot}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let n = 0
  for (const cnt of counts.values()) if (cnt > 1) n += cnt - 1
  return n
}

function occIncr(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1)
}
function occDecr(m: Map<string, number>, k: string): void {
  const v = m.get(k); if (!v) return
  if (v === 1) m.delete(k); else m.set(k, v - 1)
}
function occHas(m: Map<string, number>, k: string): boolean {
  return (m.get(k) ?? 0) > 0
}

function btValid(
  inst: any, day: string, slot: number,
  occ: BacktrackOcc, tids: string[],
  hardAvail: Map<string, HardAvail>,
): boolean {
  if (occHas(occ.lessonAtSlot, `${inst.lessonId}:${day}:${slot}`)) return false
  for (const tid of tids) {
    if (occHas(occ.teacherSlot, `${tid}:${day}:${slot}`)) return false
    // Hard teacher unavailability (INVARIANT tier) — never relaxed
    if (isHardUnavailable(tid, day, slot, hardAvail)) return false
  }
  for (const cls of inst.lesson.classes) {
    if (occHas(occ.classSlot,   `${cls.id}:${day}:${slot}`)) return false
    if (occ.groupClassSlot.has( `${cls.id}:${day}:${slot}`)) return false
    if (occHas(occ.subjectClassDay, `${inst.lesson.subjectId}:${cls.id}:${day}`)) return false  // D7
  }
  // Specialized room: only one lesson may claim the room at this slot.
  const specialRoomId = inst.lesson.subject?.specializedRoomId
  if (specialRoomId && occHas(occ.specializedRoomSlot, `${specialRoomId}:${day}:${slot}`)) return false
  return true
}

function btApply(inst: any, day: string, slot: number, occ: BacktrackOcc, tids: string[]): void {
  occIncr(occ.lessonAtSlot, `${inst.lessonId}:${day}:${slot}`)
  for (const tid of tids) occIncr(occ.teacherSlot, `${tid}:${day}:${slot}`)
  for (const cls of inst.lesson.classes) {
    occIncr(occ.classSlot,      `${cls.id}:${day}:${slot}`)
    occIncr(occ.subjectClassDay, `${inst.lesson.subjectId}:${cls.id}:${day}`)
  }
  const specialRoomId = inst.lesson.subject?.specializedRoomId
  if (specialRoomId) occIncr(occ.specializedRoomSlot, `${specialRoomId}:${day}:${slot}`)
}

function btUndo(inst: any, day: string, slot: number, occ: BacktrackOcc, tids: string[]): void {
  occDecr(occ.lessonAtSlot, `${inst.lessonId}:${day}:${slot}`)
  for (const tid of tids) occDecr(occ.teacherSlot, `${tid}:${day}:${slot}`)
  for (const cls of inst.lesson.classes) {
    occDecr(occ.classSlot,      `${cls.id}:${day}:${slot}`)
    occDecr(occ.subjectClassDay, `${inst.lesson.subjectId}:${cls.id}:${day}`)
  }
  const specialRoomId = inst.lesson.subject?.specializedRoomId
  if (specialRoomId) occDecr(occ.specializedRoomSlot, `${specialRoomId}:${day}:${slot}`)
}

function btCountValid(
  inst: any, occ: BacktrackOcc,
  slots: Array<{ day: string; slot: number }>, tids: string[],
  hardAvail: Map<string, HardAvail>,
): number {
  let n = 0
  for (const { day, slot } of slots) if (btValid(inst, day, slot, occ, tids, hardAvail)) n++
  return n
}

function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

type BtResult =
  | { ok: true;  entries: any[] }
  | { ok: false; timedOut: boolean }

/**
 * Backtracking CSP solver for Phase B (all non-group, non-sync lessons).
 *
 * @param instances  Lesson instances — pre-shuffled for variety across restarts.
 * @param initOcc    Occupancy snapshot after Phase A/A' (never mutated).
 * @param allSlots   Every (day, slot) pair in the school config.
 * @param deadline   Epoch ms; solver returns timedOut when exceeded.
 * @param restart    Restart index — used only for deterministic entry IDs.
 */
function backtrackPhaseB(
  instances: any[],
  initOcc: BacktrackOcc,
  allSlots: Array<{ day: string; slot: number }>,
  deadline: number,
  restart: number,
  hardAvail: Map<string, HardAvail>,
  softLookup: SoftLookup,
): BtResult {
  // Pre-compute teacher IDs once per instance.
  const order = instances.map(inst => ({
    inst,
    tids: lessonTeacherIds(inst.lesson),
    validCount: 0,
  }))
  // Compute valid-slot counts against initOcc for MRV ordering.
  for (const item of order) {
    item.validCount = btCountValid(item.inst, initOcc, allSlots, item.tids, hardAvail)
  }
  // MRV: fewest valid slots first.  Equal-count ties preserve the caller's
  // shuffle order, giving different exploration paths across restarts.
  order.sort((a, b) => a.validCount - b.validCount)

  // ── Value ordering: per-instance tiered shuffle ───────────────
  //
  // Slots are split into three tiers by soft-constraint penalty, then each
  // tier is independently Fisher-Yates shuffled:
  //
  //   Tier 0 — penalty = 0       (no restrictions)         → try first
  //   Tier 1 — 0 < penalty < 100 (PREFERRED / FLEXIBLE)    → try second
  //   Tier 2 — penalty ≥ 100     (IMPORTANT / NON_NEG.)    → try last
  //
  // Why tiered shuffle beats the original sort (penalty + noise[0,0.9)):
  //   The original produced a near-deterministic ordering — all free slots
  //   always before all restricted slots, with only 0.9 units of noise.
  //   Every instance tried its available days in essentially the same order,
  //   so all instances competed for the same slots simultaneously → cascade
  //   conflicts → all 30 restarts timed out.
  //
  //   The tiered shuffle preserves the directional preference (free before
  //   restricted) but randomises within each tier.  Different teachers have
  //   different tier-0 sets (Teacher A: Mon–Thu, Teacher B: Tue–Fri), so
  //   instances naturally spread across different slots rather than all
  //   rushing toward the same day-1 slot-1.  Restart diversity is maintained
  //   because Fisher-Yates produces a different shuffle every call.
  const instanceSlotOrders = order.map(({ tids }) => {
    const t0: Array<{ day: string; slot: number }> = []
    const t1: Array<{ day: string; slot: number }> = []
    const t2: Array<{ day: string; slot: number }> = []
    for (const s of allSlots) {
      const p = slotSoftPenalty(tids, s.day, s.slot, softLookup)
      if      (p === 0)  t0.push(s)
      else if (p < 100)  t1.push(s)
      else               t2.push(s)
    }
    return [...fisherYates(t0), ...fisherYates(t1), ...fisherYates(t2)]
  })

  // Clone occupancy so Phase A/A' state is never mutated.
  const occ: BacktrackOcc = {
    teacherSlot:         new Map(initOcc.teacherSlot),
    classSlot:           new Map(initOcc.classSlot),
    lessonAtSlot:        new Map(initOcc.lessonAtSlot),
    subjectClassDay:     new Map(initOcc.subjectClassDay),
    specializedRoomSlot: new Map(initOcc.specializedRoomSlot),
    groupClassSlot:      initOcc.groupClassSlot,
  }

  const placed: any[] = []
  let timedOut = false

  // Tracks which instances (by index into order[]) have been placed.
  // Used by dynamic MRV to skip already-placed lessons each level.
  const placedFlags = new Uint8Array(order.length)

  /**
   * Dynamic MRV backtracker.
   *
   * At each level we scan ALL remaining unplaced instances against the CURRENT
   * occupancy and pick the one with the fewest valid slots (most constrained).
   * This replaces both the static pre-sort (which used stale initOcc counts) and
   * the separate per-value forward-check loop:
   *
   *   Old flow: fixed order → try value → forward-check ALL remaining (per value)
   *   New flow: dynamic MRV scan ALL remaining → pick most constrained → try values
   *
   * The MRV scan doubles as a forward check: if any remaining instance has 0 valid
   * slots we detect it immediately and return false without trying any values at the
   * current level.  This prunes dead-end subtrees at the earliest possible moment
   * instead of N levels later, which is the dominant cost in tight schedules.
   *
   * Cost per level: O(remaining × slots) — same as the old forward check, but
   * paid once per level rather than once per value tried, so it's cheaper when
   * a lesson's valid slots > 1.  The real win is the reduction in total nodes
   * explored because we always branch on the variable with the least freedom.
   */
  function place(depth: number): boolean {
    if (depth === order.length) return true   // all instances placed ✓
    if (Date.now() > deadline) { timedOut = true; return false }

    // Dynamic MRV: find the unplaced instance with the fewest current valid slots.
    // Zero valid slots on any instance means the current partial assignment is
    // a dead end — return false immediately without descending further.
    let bestI     = -1
    let bestCount = Infinity
    for (let i = 0; i < order.length; i++) {
      if (placedFlags[i]) continue
      const count = btCountValid(order[i].inst, occ, allSlots, order[i].tids, hardAvail)
      if (count === 0) return false          // dead end — prune immediately
      if (count < bestCount) { bestCount = count; bestI = i }
    }

    if (bestI === -1) return true            // safety: shouldn't reach here

    placedFlags[bestI] = 1
    const { inst, tids } = order[bestI]

    for (const { day, slot } of instanceSlotOrders[bestI]) {
      if (!btValid(inst, day, slot, occ, tids, hardAvail)) continue

      btApply(inst, day, slot, occ, tids)
      placed.push({
        id: `gen-${inst.lessonId}-${restart}-${placed.length}`,
        lessonId: inst.lessonId,
        day, slot,
        roomId: null, isSeeded: false, overrides: [],
        lesson: inst.lesson,
      })

      if (place(depth + 1)) return true

      placed.pop()
      btUndo(inst, day, slot, occ, tids)
      if (timedOut) return false
    }

    placedFlags[bestI] = 0
    return false  // no valid slot found for this instance → backtrack
  }

  if (place(0)) return { ok: true, entries: placed }
  return { ok: false, timedOut }
}
