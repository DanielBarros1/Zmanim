/**
 * Lessons (Axioms) routes
 *
 * Lessons are the fixed assignments decided before scheduling begins.
 * Three types: REGULAR, SHARED, MATH_GROUP — each with different validation rules.
 *
 * GET    /api/lessons
 * POST   /api/lessons
 * PATCH  /api/lessons/:id
 * DELETE /api/lessons/:id   (guard: no active schedule entries)
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const lessonsRouter = Router()

/** Include shape used consistently across list and single-item responses */
const lessonInclude = {
  subject: true,
  teacher: true,
  classes: true,
  grade: true,
}

lessonsRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const lessons = await prisma.lesson.findMany({
      include: lessonInclude,
      orderBy: { createdAt: 'asc' },
    })
    res.json(lessons.map(formatLesson))
  } catch (err) { next(err) }
})

lessonsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const lesson = await prisma.lesson.findUniqueOrThrow({
      where: { id: req.params.id },
      include: lessonInclude,
    })
    res.json(formatLesson(lesson))
  } catch (err) { next(err) }
})

// ─── Validation schemas per lesson type ───────────────────────

const regularSchema = z.object({
  type: z.literal('REGULAR'),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid(),
  classId: z.string().uuid(),
  hoursPerWeek: z.number().int().min(1).max(10),
})

const sharedSchema = z.object({
  type: z.literal('SHARED'),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid(),
  // Must be exactly 2 class IDs from the same grade — validated in handler
  classIds: z.array(z.string().uuid()).length(2),
  hoursPerWeek: z.number().int().min(1).max(10),
})

const mathGroupSchema = z.object({
  type: z.literal('MATH_GROUP'),
  teacherId: z.string().uuid(),
  gradeId: z.string().uuid(),
  mathLevel: z.enum(['THREE_POINT', 'FOUR_POINT', 'FIVE_POINT']),
  hoursPerWeek: z.number().int().min(1).max(10),
  // subjectId resolved from the Math subject automatically (or passed explicitly)
  subjectId: z.string().uuid(),
})

const lessonCreateSchema = z.discriminatedUnion('type', [
  regularSchema,
  sharedSchema,
  mathGroupSchema,
])

lessonsRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = lessonCreateSchema.parse(req.body)

    if (body.type === 'REGULAR') {
      const lesson = await prisma.lesson.create({
        data: {
          type: 'REGULAR',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          classes: { connect: [{ id: body.classId }] },
        },
        include: lessonInclude,
      })
      return res.status(201).json(formatLesson(lesson))
    }

    if (body.type === 'SHARED') {
      // Guard: both classes must belong to the same grade
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Shared lessons must involve exactly 2 classes from the same grade.' })
      }
      const lesson = await prisma.lesson.create({
        data: {
          type: 'SHARED',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          classes: { connect: body.classIds.map(id => ({ id })) },
        },
        include: lessonInclude,
      })
      return res.status(201).json(formatLesson(lesson))
    }

    if (body.type === 'MATH_GROUP') {
      // Guard: at most one lesson per (grade, mathLevel)
      const existing = await prisma.lesson.count({
        where: { type: 'MATH_GROUP', gradeId: body.gradeId, mathLevel: body.mathLevel },
      })
      if (existing > 0) {
        return res.status(409).json({ error: `A ${body.mathLevel} math group already exists for this grade.` })
      }
      // Connect both classes in the grade to this lesson
      const gradeClasses = await prisma.class.findMany({ where: { gradeId: body.gradeId } })
      const lesson = await prisma.lesson.create({
        data: {
          type: 'MATH_GROUP',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: body.gradeId,
          mathLevel: body.mathLevel,
          classes: { connect: gradeClasses.map(c => ({ id: c.id })) },
        },
        include: lessonInclude,
      })
      return res.status(201).json(formatLesson(lesson))
    }
  } catch (err) { next(err) }
})

lessonsRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // Only hoursPerWeek and teacherId are patchable after creation
    // Changing type or class assignments requires delete + recreate
    const data = z.object({
      hoursPerWeek: z.number().int().min(1).max(10).optional(),
      teacherId: z.string().uuid().optional(),
    }).parse(req.body)

    const lesson = await prisma.lesson.update({
      where: { id: req.params.id },
      data,
      include: lessonInclude,
    })
    res.json(formatLesson(lesson))
  } catch (err) { next(err) }
})

lessonsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const inUse = await prisma.scheduleEntry.count({ where: { lessonId: req.params.id } })
    if (inUse > 0) {
      res.status(409).json({ error: 'Lesson has schedule entries and cannot be deleted. Remove all entries first.' })
      return
    }
    await prisma.lesson.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) { next(err) }
})

/** Formats a Prisma lesson (with includes) into the shared Lesson type shape */
function formatLesson(lesson: any) {
  return {
    id: lesson.id,
    type: lesson.type,
    subjectId: lesson.subjectId,
    teacherId: lesson.teacherId,
    hoursPerWeek: lesson.hoursPerWeek,
    classIds: lesson.classes.map((c: any) => c.id),
    gradeId: lesson.gradeId,
    mathLevel: lesson.mathLevel,
    subject: lesson.subject,
    teacher: { id: lesson.teacher.id, name: lesson.teacher.name },
    classes: lesson.classes,
    grade: lesson.grade,
    createdAt: lesson.createdAt,
  }
}
