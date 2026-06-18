/**
 * Schedule entry routes — place, move, remove lessons within a schedule
 *
 * POST   /api/schedules/:id/entries                       → place lesson
 * PATCH  /api/schedules/:id/entries/:entryId              → move lesson
 * DELETE /api/schedules/:id/entries/:entryId              → remove lesson
 * PATCH  /api/schedules/:id/entries/:entryId/room         → change room assignment
 * POST   /api/schedules/:id/entries/:entryId/override     → add override after the fact
 * PATCH  /api/schedules/:id/entries/:entryId/seed         → toggle isSeeded (for AS seed mode)
 *
 * All write operations run the authoritative evaluator and return violations
 * alongside the updated entry. The client uses violations to update the UI.
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { evaluate } from '../services/evaluator'
import { autoAssignRoom } from '../services/roomAssignment'
import { suggestFix } from '../services/suggestFix'

export const entriesRouter = Router()

const overrideSchema = z.object({
  restrictionType: z.string(),
  restrictionId: z.string().uuid().optional(),
  note: z.string().optional(),
})

// ─── Get all entries ───────────────────────────────────────────

entriesRouter.get('/:id/entries', requireAuth, async (req, res, next) => {
  try {
    const entries = await prisma.scheduleEntry.findMany({
      where: { scheduleId: req.params.id },
      include: { overrides: true },
      orderBy: [{ day: 'asc' }, { slot: 'asc' }],
    })
    res.json(entries)
  } catch (err) { next(err) }
})

// ─── Evaluate current state without modifying anything ────────

entriesRouter.get('/:id/evaluate', requireAuth, async (req, res, next) => {
  try {
    const evalResult = await runEvaluation(req.params.id)
    res.json(evalResult)
  } catch (err) { next(err) }
})

// ─── Evaluate a hypothetical placement ──────────────────────────

entriesRouter.post('/:id/evaluate-placement', requireAuth, async (req, res, next) => {
  try {
    const scheduleId = req.params.id
    const body = z.object({
      lessonId: z.string().uuid(),
      day: z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']),
      slot: z.number().int().min(1).max(10),
      classId: z.string().uuid(),
    }).parse(req.body)

    const [schedule, lessons, restrictions, config] = await Promise.all([
      prisma.schedule.findUniqueOrThrow({
        where: { id: scheduleId },
        include: {
          entries: {
            include: {
              overrides: true,
              lesson: { include: { classes: true, subject: true, grade: true, lessonTeachers: true } }
            }
          }
        },
      }),
      prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true, lessonTeachers: true } }),
      prisma.restriction.findMany({ where: { isActive: true } }),
      prisma.schoolConfig.findFirst(),
    ])

    const lesson = lessons.find(l => l.id === body.lessonId)
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' })
    }

    // Auto-assign a room for the hypothetical entry so we can detect room conflicts
    const assigned = await autoAssignRoom({
      scheduleId,
      lessonId: body.lessonId,
      day: body.day,
      slot: body.slot,
    })

    // Create a hypothetical entry with assigned room
    const hypotheticalEntry = {
      id: 'hypothetical',
      scheduleId,
      lessonId: body.lessonId,
      day: body.day,
      slot: body.slot,
      roomId: assigned.roomId,
      roomId2: assigned.roomId2,
      isSeeded: false,
      overrides: [],
      lesson,
    }

    // Evaluate with the hypothetical entry added
    const evalResult = evaluate({
      entries: [...schedule.entries, hypotheticalEntry] as any,
      lessons: lessons as any,
      restrictions: restrictions as any,
      config: config as any,
      overrides: schedule.entries.flatMap(e => e.overrides) as any,
    })

    // Only return violations that involve the hypothetical entry
    const relevantViolations = evalResult.violations.filter(v =>
      v.affectedEntryIds.includes('hypothetical')
    )

    res.json({ ...evalResult, violations: relevantViolations })
  } catch (err) { next(err) }
})

// ─── Place lesson ──────────────────────────────────────────────

entriesRouter.post('/:id/entries', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const scheduleId = req.params.id
    const body = z.object({
      lessonId: z.string().uuid(),
      day: z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']),
      slot: z.number().int().min(1).max(10),
      roomId: z.string().uuid().optional(),
      roomId2: z.string().uuid().optional(),
      overrides: z.array(overrideSchema).optional(),
    }).parse(req.body)

    // Auto-assign rooms if not provided (PARALLEL gets two)
    const assigned = await autoAssignRoom({
      scheduleId,
      lessonId: body.lessonId,
      day: body.day,
      slot: body.slot,
    })
    const roomId  = body.roomId  !== undefined ? body.roomId  : assigned.roomId
    const roomId2 = body.roomId2 !== undefined ? body.roomId2 : assigned.roomId2

    const entry = await prisma.scheduleEntry.create({
      data: {
        scheduleId,
        lessonId: body.lessonId,
        day: body.day,
        slot: body.slot,
        roomId:  roomId  ?? null,
        roomId2: roomId2 ?? null,
        overrides: body.overrides ? {
          create: body.overrides.map(o => ({
            restrictionType: o.restrictionType as any,
            restrictionId: o.restrictionId,
            note: o.note,
          })),
        } : undefined,
      },
      include: { overrides: true },
    })

    // Run authoritative evaluation for the whole schedule
    const evalResult = await runEvaluation(scheduleId)

    res.status(201).json({ entry, evaluation: evalResult })
  } catch (err) { next(err) }
})

// ─── Move lesson ───────────────────────────────────────────────

entriesRouter.patch('/:id/entries/:entryId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id: scheduleId, entryId } = req.params
    const body = z.object({
      day: z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']),
      slot: z.number().int().min(1).max(10),
      roomId: z.string().uuid().nullable().optional(),
      roomId2: z.string().uuid().nullable().optional(),
      overrides: z.array(overrideSchema).optional(),
    }).parse(req.body)

    // Resolve rooms: null clears, undefined auto-assigns, explicit value wins
    const existing = await prisma.scheduleEntry.findUniqueOrThrow({ where: { id: entryId } })
    let roomId: string | null
    let roomId2: string | null

    if (body.roomId === null) {
      roomId = null
    } else if (body.roomId !== undefined) {
      roomId = body.roomId
    } else {
      const assigned = await autoAssignRoom({
        scheduleId,
        lessonId: existing.lessonId,
        day: body.day,
        slot: body.slot,
        excludeEntryId: entryId,
      })
      roomId  = assigned.roomId  ?? existing.roomId
      roomId2 = assigned.roomId2 ?? existing.roomId2
    }

    if (body.roomId2 === null) {
      roomId2 = null
    } else if (body.roomId2 !== undefined) {
      roomId2 = body.roomId2
    } else {
      roomId2 ??= existing.roomId2
    }

    const entry = await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: {
        day: body.day,
        slot: body.slot,
        roomId,
        roomId2,
        // Replace overrides if provided
        ...(body.overrides && {
          overrides: {
            deleteMany: {},
            create: body.overrides.map(o => ({
              restrictionType: o.restrictionType as any,
              restrictionId: o.restrictionId,
              note: o.note,
            })),
          },
        }),
      },
      include: { overrides: true },
    })

    const evalResult = await runEvaluation(scheduleId)
    res.json({ entry, evaluation: evalResult })
  } catch (err) { next(err) }
})

// ─── Remove lesson ─────────────────────────────────────────────

entriesRouter.delete('/:id/entries/:entryId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id: scheduleId, entryId } = req.params
    await prisma.scheduleEntry.delete({ where: { id: entryId } })
    const evalResult = await runEvaluation(scheduleId)
    res.json({ evaluation: evalResult })
  } catch (err) { next(err) }
})

// ─── Change room ───────────────────────────────────────────────

entriesRouter.patch('/:id/entries/:entryId/room', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { entryId } = req.params
    const body = z.object({
      roomId:  z.string().uuid().nullable().optional(),
      roomId2: z.string().uuid().nullable().optional(),
    }).parse(req.body)
    const entry = await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: {
        ...(body.roomId  !== undefined && { roomId:  body.roomId }),
        ...(body.roomId2 !== undefined && { roomId2: body.roomId2 }),
      },
      include: { overrides: true },
    })
    res.json(entry)
  } catch (err) { next(err) }
})

// ─── Add override ──────────────────────────────────────────────

entriesRouter.post('/:id/entries/:entryId/override', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { entryId } = req.params
    const body = overrideSchema.parse(req.body)
    const override = await prisma.override.create({
      data: {
        entryId,
        restrictionType: body.restrictionType as any,
        restrictionId: body.restrictionId,
        note: body.note,
      },
    })
    res.status(201).json(override)
  } catch (err) { next(err) }
})

// ─── Remove override ──────────────────────────────────────────

/**
 * DELETE /api/schedules/:id/entries/:entryId/override
 * Body: { restrictionType, restrictionId? }
 *
 * Deletes any matching Override record(s) from the entry, then returns a
 * fresh EvaluationResult so the client can update the violation panel.
 */
entriesRouter.delete('/:id/entries/:entryId/override', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id: scheduleId, entryId } = req.params
    const { restrictionType, restrictionId } = z.object({
      restrictionType: z.string(),
      restrictionId: z.string().uuid().nullable().optional(),
    }).parse(req.body)

    await prisma.override.deleteMany({
      where: {
        entryId,
        restrictionType: restrictionType as any,
        // Only match on restrictionId when one is provided — hard invariant
        // overrides have no restrictionId so we only match by type.
        ...(restrictionId != null ? { restrictionId } : {}),
      },
    })

    const evalResult = await runEvaluation(scheduleId)
    res.json({ evaluation: evalResult })
  } catch (err) { next(err) }
})

// ─── Toggle seed ───────────────────────────────────────────────

entriesRouter.patch('/:id/entries/:entryId/seed', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { entryId } = req.params
    const { isSeeded } = z.object({ isSeeded: z.boolean() }).parse(req.body)
    const entry = await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: { isSeeded },
      include: { overrides: true },
    })
    res.json(entry)
  } catch (err) { next(err) }
})

// ─── Suggest fix ──────────────────────────────────────────────

/**
 * POST /api/schedules/:id/suggest-fix
 *
 * Given a violation type + the affected entry IDs, returns up to 3 concrete
 * move operations that would improve or resolve the violation.
 *
 * The computation is entirely in-memory (no DB writes). The evaluator is run
 * once per candidate move to compare scores. See services/suggestFix.ts for
 * the full algorithm and supported violation types.
 */
entriesRouter.post('/:id/suggest-fix', requireAuth, async (req, res, next) => {
  try {
    const scheduleId = req.params.id
    const body = z.object({
      violationType:    z.string(),
      affectedEntryIds: z.array(z.string().uuid()),
      restrictionId:    z.string().uuid().nullable().optional(),
    }).parse(req.body)

    // Load all data needed by the suggestion engine (same as runEvaluation)
    const [schedule, lessons, restrictions, config] = await Promise.all([
      prisma.schedule.findUniqueOrThrow({
        where: { id: scheduleId },
        include: { entries: { include: { overrides: true } } },
      }),
      prisma.lesson.findMany({
        include: { classes: true, subject: true, grade: true, lessonTeachers: true, teacher: true },
      }),
      prisma.restriction.findMany({ where: { isActive: true } }),
      prisma.schoolConfig.findFirst(),
    ])

    if (!config) {
      res.json([])
      return
    }

    // Enrich entries with their lesson objects (same join as runEvaluation)
    const lessonMap = new Map(lessons.map(l => [l.id, l]))
    const enrichedEntries = schedule.entries
      .map(e => ({ ...e, lesson: lessonMap.get(e.lessonId) }))
      .filter(e => e.lesson != null) as any[]

    const suggestions = suggestFix({
      violationType:    body.violationType,
      affectedEntryIds: body.affectedEntryIds,
      entries:          enrichedEntries,
      lessons:          lessons as any[],
      restrictions:     restrictions as any[],
      config:           { slotsPerDay: config.slotsPerDay, workDays: config.workDays as string[], subjectTwicePerDayAllowed: config.subjectTwicePerDayAllowed },
    })

    res.json(suggestions)
  } catch (err) { next(err) }
})

// ─── Helpers ───────────────────────────────────────────────────

async function runEvaluation(scheduleId: string) {
  const [schedule, lessons, restrictions, config] = await Promise.all([
    prisma.schedule.findUniqueOrThrow({
      where: { id: scheduleId },
      include: { entries: { include: { overrides: true } } },
    }),
    prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true, lessonTeachers: true } }),
    prisma.restriction.findMany({ where: { isActive: true } }),
    prisma.schoolConfig.findFirst(),
  ])

  // The evaluator expects each entry to carry its lesson object inline
  // (entry.lesson.teacherId, entry.lesson.classes, etc.).
  // The Prisma query above only fetches overrides, not lessons, so we
  // join them here using the already-fetched lessons array.
  const lessonMap = new Map(lessons.map(l => [l.id, l]))
  const enrichedEntries = schedule.entries
    .map(e => ({ ...e, lesson: lessonMap.get(e.lessonId) }))
    .filter(e => e.lesson != null)  // skip orphaned entries (lesson was deleted)

  return evaluate({
    entries: enrichedEntries as any,
    lessons: lessons as any,
    restrictions: restrictions as any,
    config: config as any,
    overrides: schedule.entries.flatMap(e => e.overrides) as any,
  })
}
