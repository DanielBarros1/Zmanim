/**
 * Restrictions routes — CRUD
 *
 * GET    /api/restrictions              (filterable: ?teacherId=, ?classId=, ?type=, ?tier=)
 * POST   /api/restrictions
 * PATCH  /api/restrictions/:id
 * DELETE /api/restrictions/:id
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const restrictionsRouter = Router()

restrictionsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { teacherId, classId, gradeId, lessonId, type, tier } = req.query
    const restrictions = await prisma.restriction.findMany({
      where: {
        ...(teacherId && { teacherId: String(teacherId) }),
        ...(classId && { classId: String(classId) }),
        ...(gradeId && { gradeId: String(gradeId) }),
        ...(lessonId && { lessonId: String(lessonId) }),
        ...(type && { type: String(type) as any }),
        ...(tier && { tier: String(tier) as any }),
      },
      orderBy: { createdAt: 'asc' },
    })
    res.json(restrictions)
  } catch (err) { next(err) }
})

const restrictionSchema = z.object({
  type: z.string(),   // RestrictionType enum — validated as string (Zod doesn't know Prisma enums)
  // INVARIANT is allowed for teacher availability types (physical impossibility).
  // All other types default to NON_NEGOTIABLE at most — INVARIANT is excluded by the UI
  // for non-availability restrictions.
  tier: z.enum(['INVARIANT', 'NON_NEGOTIABLE', 'IMPORTANT', 'PREFERRED', 'FLEXIBLE']),
  teacherId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  lessonId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  params: z.record(z.unknown()).default({}),
  note: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
})

restrictionsRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = restrictionSchema.parse(req.body)
    const restriction = await prisma.restriction.create({ data: data as any })
    res.status(201).json(restriction)
  } catch (err) { next(err) }
})

restrictionsRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = restrictionSchema.partial().parse(req.body)
    const restriction = await prisma.restriction.update({
      where: { id: req.params.id },
      data: data as any,
    })
    res.json(restriction)
  } catch (err) { next(err) }
})

restrictionsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.restriction.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) { next(err) }
})
