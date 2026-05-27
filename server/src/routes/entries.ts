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

export const entriesRouter = Router()

const overrideSchema = z.object({
  restrictionType: z.string(),
  restrictionId: z.string().uuid().optional(),
  note: z.string().optional(),
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
      overrides: z.array(overrideSchema).optional(),
    }).parse(req.body)

    // Auto-assign room if not provided
    const roomId = body.roomId ?? await autoAssignRoom({
      scheduleId,
      lessonId: body.lessonId,
      day: body.day,
      slot: body.slot,
    })

    const entry = await prisma.scheduleEntry.create({
      data: {
        scheduleId,
        lessonId: body.lessonId,
        day: body.day,
        slot: body.slot,
        roomId: roomId ?? null,
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
      overrides: z.array(overrideSchema).optional(),
    }).parse(req.body)

    // Resolve room: if roomId explicitly null → clear it; if undefined → auto-assign
    let roomId: string | null
    if (body.roomId === null) {
      roomId = null
    } else if (body.roomId !== undefined) {
      roomId = body.roomId
    } else {
      const existing = await prisma.scheduleEntry.findUniqueOrThrow({ where: { id: entryId } })
      roomId = await autoAssignRoom({
        scheduleId,
        lessonId: existing.lessonId,
        day: body.day,
        slot: body.slot,
        excludeEntryId: entryId,
      }) ?? existing.roomId
    }

    const entry = await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: {
        day: body.day,
        slot: body.slot,
        roomId,
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
    const { roomId } = z.object({ roomId: z.string().uuid().nullable() }).parse(req.body)
    const entry = await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: { roomId },
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

// ─── Helpers ───────────────────────────────────────────────────

async function runEvaluation(scheduleId: string) {
  const [schedule, lessons, restrictions, config] = await Promise.all([
    prisma.schedule.findUniqueOrThrow({
      where: { id: scheduleId },
      include: { entries: { include: { overrides: true } } },
    }),
    prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true } }),
    prisma.restriction.findMany({ where: { isActive: true } }),
    prisma.schoolConfig.findFirst(),
  ])

  return evaluate({
    entries: schedule.entries as any,
    lessons: lessons as any,
    restrictions: restrictions as any,
    config: config as any,
    overrides: schedule.entries.flatMap(e => e.overrides) as any,
  })
}
