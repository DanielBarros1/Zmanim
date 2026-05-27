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
    // Guard: can't delete if used in any lesson
    const inUse = await prisma.lesson.count({ where: { subjectId: req.params.id } })
    if (inUse > 0) {
      res.status(409).json({ error: 'Subject is used in one or more lessons and cannot be deleted.' })
      return
    }
    await prisma.subject.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) { next(err) }
})
