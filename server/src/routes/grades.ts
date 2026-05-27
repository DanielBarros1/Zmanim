/**
 * Grades & Classes routes
 *
 * Grades 7–12 with classes A and B are seeded on first run (see seed.ts).
 * These routes expose them for the UI to consume — no creation needed.
 *
 * GET /api/grades           → all grades with their classes
 * GET /api/grades/:id/classes → classes for a specific grade
 */

import { Router } from 'express'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'

export const gradesRouter = Router()

gradesRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const grades = await prisma.grade.findMany({
      include: { classes: { orderBy: { section: 'asc' } } },
      orderBy: { number: 'asc' },
    })
    res.json(grades)
  } catch (err) { next(err) }
})

gradesRouter.get('/:id/classes', requireAuth, async (req, res, next) => {
  try {
    const classes = await prisma.class.findMany({
      where: { gradeId: req.params.id },
      orderBy: { section: 'asc' },
    })
    res.json(classes)
  } catch (err) { next(err) }
})
