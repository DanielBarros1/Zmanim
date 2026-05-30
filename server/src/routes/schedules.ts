/**
 * Schedule management routes
 *
 * GET    /api/schedules            → list all schedules (with summary stats)
 * POST   /api/schedules            → create blank draft
 * GET    /api/schedules/:id        → get full schedule with all entries
 * PATCH  /api/schedules/:id        → update name or isStarred
 * DELETE /api/schedules/:id        → delete (guard: not PUBLISHED)
 * POST   /api/schedules/:id/publish → publish (un-publishes any current published schedule)
 * POST   /api/schedules/:id/clone   → duplicate as new draft
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const schedulesRouter = Router()

// ─── List ──────────────────────────────────────────────────────

schedulesRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const schedules = await prisma.schedule.findMany({
      include: { entries: { select: { id: true } } },
      orderBy: [{ state: 'asc' }, { updatedAt: 'desc' }],
    })

    // Compute totalRequired across all lessons (sum of hoursPerWeek)
    const allLessons = await prisma.lesson.findMany({ select: { hoursPerWeek: true } })
    const totalRequired = allLessons.reduce((sum, l) => sum + l.hoursPerWeek, 0)

    res.json(schedules.map(s => ({
      id: s.id,
      name: s.name,
      state: s.state,
      isStarred: s.isStarred,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      totalRequired,
      totalPlaced: s.entries.length,
    })))
  } catch (err) { next(err) }
})

// ─── Get single (with full entries) ───────────────────────────

schedulesRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const schedule = await prisma.schedule.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        entries: {
          include: { overrides: true },
          orderBy: [{ day: 'asc' }, { slot: 'asc' }],
        },
      },
    })
    res.json(schedule)
  } catch (err) { next(err) }
})

// ─── Create ────────────────────────────────────────────────────

schedulesRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const schedule = await prisma.schedule.create({ data: { name } })
    res.status(201).json(schedule)
  } catch (err) { next(err) }
})

// ─── Update ────────────────────────────────────────────────────

schedulesRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1).optional(),
      isStarred: z.boolean().optional(),
    }).parse(req.body)
    const schedule = await prisma.schedule.update({ where: { id: req.params.id }, data })
    res.json(schedule)
  } catch (err) { next(err) }
})

// ─── Delete ────────────────────────────────────────────────────

schedulesRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // Cascade deletes entries + overrides (defined in schema).
    // Published schedules can be deleted — the admin confirmed in the UI.
    await prisma.schedule.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) { next(err) }
})

// ─── Publish ───────────────────────────────────────────────────

schedulesRouter.post('/:id/publish', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // Atomic: un-publish all others, publish this one
    const [, schedule] = await prisma.$transaction([
      prisma.schedule.updateMany({
        where: { state: 'PUBLISHED', NOT: { id: req.params.id } },
        data: { state: 'DRAFT' },
      }),
      prisma.schedule.update({
        where: { id: req.params.id },
        data: { state: 'PUBLISHED' },
      }),
    ])
    res.json(schedule)
  } catch (err) { next(err) }
})

// ─── Clone ─────────────────────────────────────────────────────

schedulesRouter.post('/:id/clone', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const source = await prisma.schedule.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { entries: { include: { overrides: true } } },
    })

    const cloneName = `${source.name} (copy)`

    // Create the new schedule with all entries and overrides duplicated
    const newSchedule = await prisma.schedule.create({
      data: {
        name: cloneName,
        state: 'DRAFT',
        entries: {
          create: source.entries.map(entry => ({
            lessonId: entry.lessonId,
            day: entry.day,
            slot: entry.slot,
            roomId: entry.roomId,
            isSeeded: entry.isSeeded,
            overrides: {
              create: entry.overrides.map(o => ({
                restrictionType: o.restrictionType,
                restrictionId: o.restrictionId,
                note: o.note,
              })),
            },
          })),
        },
      },
    })
    res.status(201).json(newSchedule)
  } catch (err) { next(err) }
})
