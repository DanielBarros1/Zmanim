/**
 * Subjects routes — CRUD
 *
 * GET    /api/subjects
 * POST   /api/subjects
 * PATCH  /api/subjects/:id
 * DELETE /api/subjects/:id   (guard: not referenced in any lesson)
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const subjectsRouter = Router()

subjectsRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const subjects = await prisma.subject.findMany({ orderBy: { name: 'asc' } })
    res.json(subjects)
  } catch (err) { next(err) }
})

const subjectSchema = z.object({
  name: z.string().min(1),
  isArts: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  noRoomRequired: z.boolean().default(false),
  specializedRoomId: z.string().uuid().nullable().optional(),
})

subjectsRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = subjectSchema.parse(req.body)
    const subject = await prisma.subject.create({ data })
    res.status(201).json(subject)
  } catch (err) { next(err) }
})

subjectsRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = subjectSchema.partial().parse(req.body)
    const subject = await prisma.subject.update({ where: { id: req.params.id }, data })
    res.json(subject)
  } catch (err) { next(err) }
})

subjectsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id

    // Cascade-delete lessons: overrides → entries → lesson-restrictions → lessons
    const lessonIds = (
      await prisma.lesson.findMany({ where: { subjectId: id }, select: { id: true } })
    ).map(l => l.id)

    if (lessonIds.length > 0) {
      const entryIds = (
        await prisma.scheduleEntry.findMany({ where: { lessonId: { in: lessonIds } }, select: { id: true } })
      ).map(e => e.id)
      if (entryIds.length > 0) {
        await prisma.override.deleteMany({ where: { entryId: { in: entryIds } } })
        await prisma.scheduleEntry.deleteMany({ where: { lessonId: { in: lessonIds } } })
      }
      await prisma.restriction.deleteMany({ where: { lessonId: { in: lessonIds } } })
      await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } })
    }

    // Delete restrictions that reference this subject directly
    await prisma.restriction.deleteMany({ where: { subjectId: id } })

    await prisma.subject.delete({ where: { id } })
    res.status(204).send()
  } catch (err) { next(err) }
})
