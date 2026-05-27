/**
 * Auto-scheduler service
 *
 * Implements random-restart penalty-minimization with local search.
 * Runs in a Node.js worker thread to avoid blocking the event loop.
 *
 * Algorithm per restart:
 *   1. Copy seeded entries (immovable anchors)
 *   2. Expand all lessons into placement instances (one per required hour)
 *   3. Randomly assign unplaced instances to (day, slot) combinations
 *   4. Run local search: repeatedly try swapping or moving two entries,
 *      keep the change if it improves the penalty score
 *   5. Track the best schedule across all restarts
 *
 * On completion: creates a new DRAFT Schedule in the DB and updates the job record.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads'
import { prisma } from '../db'
import { evaluate } from './evaluator'
import { DAY_ORDER } from '@zmanim/shared'

// ─── Job tracking (in-memory) ─────────────────────────────────

export type JobStatus = {
  jobId: string
  status: 'RUNNING' | 'DONE' | 'ERROR'
  progress: number   // 0–100
  scheduleId?: string
  error?: string
}

const jobs = new Map<string, JobStatus>()

export function getJob(jobId: string): JobStatus | undefined {
  return jobs.get(jobId)
}

// ─── Start a job (main thread) ────────────────────────────────

interface JobInput {
  jobId: string
  name: string
  seedScheduleId?: string
  nRestarts: number
  nIterations: number
}

export async function startAutoSchedulerJob(input: JobInput): Promise<void> {
  jobs.set(input.jobId, { jobId: input.jobId, status: 'RUNNING', progress: 0 })

  // Fetch all data needed by the algorithm
  const [lessons, restrictions, config, seedEntries] = await Promise.all([
    prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true } }),
    prisma.restriction.findMany({ where: { isActive: true } }),
    prisma.schoolConfig.findFirst(),
    input.seedScheduleId
      ? prisma.scheduleEntry.findMany({
          where: { scheduleId: input.seedScheduleId, isSeeded: true },
          include: { overrides: true },
        })
      : Promise.resolve([]),
  ])

  const slotsPerDay = config?.slotsPerDay ?? 4

  // Run the algorithm in a worker thread
  const worker = new Worker(__filename, {
    workerData: {
      lessons,
      restrictions,
      slotsPerDay,
      seedEntries,
      nRestarts: input.nRestarts,
      nIterations: input.nIterations,
      jobId: input.jobId,
    },
  })

  worker.on('message', async (msg: { type: string; progress?: number; entries?: any[] }) => {
    if (msg.type === 'progress') {
      const job = jobs.get(input.jobId)
      if (job) job.progress = msg.progress ?? 0
    }

    if (msg.type === 'result' && msg.entries) {
      try {
        // Create the new DRAFT schedule with all computed entries
        const schedule = await prisma.schedule.create({
          data: {
            name: input.name,
            state: 'DRAFT',
            entries: {
              create: msg.entries.map((e: any) => ({
                lessonId: e.lessonId,
                day: e.day,
                slot: e.slot,
                roomId: e.roomId ?? null,
                isSeeded: e.isSeeded ?? false,
              })),
            },
          },
        })
        jobs.set(input.jobId, {
          jobId: input.jobId,
          status: 'DONE',
          progress: 100,
          scheduleId: schedule.id,
        })
      } catch (err: any) {
        jobs.set(input.jobId, {
          jobId: input.jobId,
          status: 'ERROR',
          progress: 0,
          error: err.message,
        })
      }
    }
  })

  worker.on('error', (err) => {
    jobs.set(input.jobId, {
      jobId: input.jobId,
      status: 'ERROR',
      progress: 0,
      error: err.message,
    })
  })
}

// ─── Worker thread ─────────────────────────────────────────────

if (!isMainThread) {
  runWorker(workerData)
}

async function runWorker(data: any) {
  const { lessons, restrictions, slotsPerDay, seedEntries, nRestarts, nIterations } = data
  const days = DAY_ORDER

  // Expand lessons into placement instances
  // Each lesson needs hoursPerWeek entries in the final schedule
  const instances = expandLessons(lessons)
  const seededLessonKeys = new Set(seedEntries.map((e: any) => `${e.lessonId}:${e.day}:${e.slot}`))

  // Filter out instances already covered by seed
  const toPlace = instances.filter((inst: any) =>
    !seedEntries.some((se: any) => se.lessonId === inst.lessonId)
  )

  let bestEntries: any[] = []
  let bestScore = Infinity

  for (let restart = 0; restart < nRestarts; restart++) {
    // Step 1: Start with seed entries
    let entries: any[] = seedEntries.map((se: any) => ({
      id: `seed-${se.id}`,
      lessonId: se.lessonId,
      day: se.day,
      slot: se.slot,
      roomId: se.roomId,
      isSeeded: true,
      overrides: se.overrides ?? [],
      lesson: lessons.find((l: any) => l.id === se.lessonId),
    })).filter((e: any) => e.lesson)

    // Step 2: Random initial placement for non-seeded instances
    const shuffled = [...toPlace].sort(() => Math.random() - 0.5)
    for (const inst of shuffled) {
      const day = days[Math.floor(Math.random() * days.length)]
      const slot = Math.floor(Math.random() * slotsPerDay) + 1
      entries.push({
        id: `gen-${inst.lessonId}-${Math.random()}`,
        lessonId: inst.lessonId,
        day,
        slot,
        roomId: null,
        isSeeded: false,
        overrides: [],
        lesson: inst.lesson,
      })
    }

    // Step 3: Local search (hill climbing)
    let score = evaluate({ entries, lessons, restrictions, config: { slotsPerDay }, overrides: [] }).score

    for (let iter = 0; iter < nIterations; iter++) {
      const nonSeeded = entries.filter(e => !e.isSeeded)
      if (nonSeeded.length < 2) break

      if (Math.random() < 0.7) {
        // Swap two random entries' (day, slot)
        const i = Math.floor(Math.random() * nonSeeded.length)
        const j = Math.floor(Math.random() * nonSeeded.length)
        if (i === j) continue

        const a = nonSeeded[i]
        const b = nonSeeded[j]
        const candidate = entries.map(e => {
          if (e.id === a.id) return { ...e, day: b.day, slot: b.slot }
          if (e.id === b.id) return { ...e, day: a.day, slot: a.slot }
          return e
        })
        const candidateScore = evaluate({ entries: candidate, lessons, restrictions, config: { slotsPerDay }, overrides: [] }).score
        if (candidateScore < score) {
          entries = candidate
          score = candidateScore
        }
      } else {
        // Random move: pick one entry and assign a new (day, slot)
        const idx = Math.floor(Math.random() * nonSeeded.length)
        const entry = nonSeeded[idx]
        const newDay = days[Math.floor(Math.random() * days.length)]
        const newSlot = Math.floor(Math.random() * slotsPerDay) + 1
        const candidate = entries.map(e =>
          e.id === entry.id ? { ...e, day: newDay, slot: newSlot } : e
        )
        const candidateScore = evaluate({ entries: candidate, lessons, restrictions, config: { slotsPerDay }, overrides: [] }).score
        if (candidateScore < score) {
          entries = candidate
          score = candidateScore
        }
      }
    }

    if (score < bestScore) {
      bestScore = score
      bestEntries = entries
    }

    parentPort?.postMessage({ type: 'progress', progress: Math.round(((restart + 1) / nRestarts) * 100) })
  }

  parentPort?.postMessage({ type: 'result', entries: bestEntries })
}

/** Expand lessons into individual placement instances */
function expandLessons(lessons: any[]): Array<{ lessonId: string; lesson: any }> {
  const instances: Array<{ lessonId: string; lesson: any }> = []
  for (const lesson of lessons) {
    for (let i = 0; i < lesson.hoursPerWeek; i++) {
      instances.push({ lessonId: lesson.id, lesson })
    }
  }
  return instances
}
