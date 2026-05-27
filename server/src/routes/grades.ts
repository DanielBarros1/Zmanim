/**
 * Grades & Classes routes
 *
 * Grades 7–12 with classes A and B are seeded on first run (see seed.ts).
 * These routes expose them for the UI to consume — no creation needed.
 *
 * GET /api/grades               → all Grade objects (id, number)
 * GET /api/grades/:id/classes   → classes for a specific grade
 * GET /api/classes              → all Class objects across all grades
 */

import { Router } from 'express'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'

export const gradesRouter = Router()

// GET /api/grades — flat list without nested classes
gradesRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const grades = await prisma.grade.findMany({
      orderBy: { number: 'asc' },
    })
    res.json(grades)
  } catch (err) { next(err) }
})

// GET /api/grades/:id/classes
gradesRouter.get('/:id/classes', requireAuth, async (req, res, next) => {
  try {
    const classes = await prisma.class.findMany({
      where: { gradeId: req.params.id },
      orderBy: { section: 'asc' },
    })
    res.json(classes)
  } catch (err) { next(err) }
})

// GET /api/classes — all classes across all grades (flat list)
// Registered on gradesRouter under /classes prefix — see app.ts
export const classesRouter = Router()

classesRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const classes = await prisma.class.findMany({
      orderBy: [{ grade: { number: 'asc' } }, { section: 'asc' }],
    })
    res.json(classes)
  } catch (err) { next(err) }
})
