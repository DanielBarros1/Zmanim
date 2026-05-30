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
  lessonTeachers: true,
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
  // Accept classIds array of exactly 1 to match the unified client API shape
  classIds: z.array(z.string().uuid()).length(1),
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

const englishGroupSchema = z.object({
  type: z.literal('ENGLISH_GROUP'),
  teacherId: z.string().uuid(),
  gradeId: z.string().uuid(),
  englishLevel: z.enum(['THREE_POINT', 'FOUR_POINT', 'FIVE_POINT']),
  hoursPerWeek: z.number().int().min(1).max(10),
  subjectId: z.string().uuid(),
})

// LessonTeacher entry shape (used by PARALLEL and MULTI_TEACHER)
const lessonTeacherEntrySchema = z.object({
  teacherId: z.string().uuid(),
  classId: z.string().uuid().nullable().optional(),
})

const parallelSchema = z.object({
  type: z.literal('PARALLEL'),
  subjectId: z.string().uuid(),
  // Two classes from the same grade — validated in handler
  classIds: z.array(z.string().uuid()).length(2),
  hoursPerWeek: z.number().int().min(1).max(10),
  // Exactly two entries: one per class, each pairing a teacher with a class
  lessonTeachers: z.array(lessonTeacherEntrySchema).length(2),
})

const multiTeacherSchema = z.object({
  type: z.literal('MULTI_TEACHER'),
  subjectId: z.string().uuid(),
  // Two classes from the same grade — validated in handler
  classIds: z.array(z.string().uuid()).length(2),
  hoursPerWeek: z.number().int().min(1).max(10),
  // Two or more teachers (no classId — all teachers share the room)
  lessonTeachers: z.array(lessonTeacherEntrySchema).min(2),
})

const lessonCreateSchema = z.discriminatedUnion('type', [
  regularSchema,
  sharedSchema,
  parallelSchema,
  mathGroupSchema,
  englishGroupSchema,
  multiTeacherSchema,
])

lessonsRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = lessonCreateSchema.parse(req.body)

    /** Ensure the teacher is linked to the subject (idempotent connect). */
    const ensureTeacherSubject = () =>
      prisma.teacher.update({
        where: { id: (body as any).teacherId },
        data: { subjects: { connect: [{ id: body.subjectId }] } },
      })

    /** Ensure multiple teachers are linked to the subject (PARALLEL/MULTI_TEACHER). */
    const ensureTeachersSubject = async (teacherIds: string[]) => {
      await Promise.all(teacherIds.map(tid =>
        prisma.teacher.update({
          where: { id: tid },
          data: { subjects: { connect: [{ id: body.subjectId }] } },
        })
      ))
    }

    if (body.type === 'REGULAR') {
      const [classId] = body.classIds
      const lesson = await prisma.lesson.create({
        data: {
          type: 'REGULAR',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          classes: { connect: [{ id: classId }] },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
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
      await ensureTeacherSubject()
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
      await ensureTeacherSubject()
      return res.status(201).json(formatLesson(lesson))
    }

    if (body.type === 'ENGLISH_GROUP') {
      // Guard: at most one lesson per (grade, englishLevel)
      const existing = await prisma.lesson.count({
        where: { type: 'ENGLISH_GROUP', gradeId: body.gradeId, englishLevel: body.englishLevel as any },
      })
      if (existing > 0) {
        return res.status(409).json({ error: `A ${body.englishLevel} English group already exists for this grade.` })
      }
      // Connect both classes in the grade to this lesson
      const gradeClasses = await prisma.class.findMany({ where: { gradeId: body.gradeId } })
      const lesson = await prisma.lesson.create({
        data: {
          type: 'ENGLISH_GROUP',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: body.gradeId,
          englishLevel: body.englishLevel as any,
          classes: { connect: gradeClasses.map(c => ({ id: c.id })) },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
      return res.status(201).json(formatLesson(lesson))
    }

    if (body.type === 'PARALLEL') {
      // Guard: both classes must belong to the same grade
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Parallel lessons must involve exactly 2 classes from the same grade.' })
      }
      // Guard: each LessonTeacher entry's classId must be one of the two classIds
      const validClassIds = new Set(body.classIds)
      const invalidEntry = body.lessonTeachers.find(lt => lt.classId && !validClassIds.has(lt.classId))
      if (invalidEntry) {
        return res.status(400).json({ error: 'Each teacher in a Parallel lesson must be assigned to one of the two classes.' })
      }
      const lesson = await prisma.lesson.create({
        data: {
          type: 'PARALLEL',
          subjectId: body.subjectId,
          hoursPerWeek: body.hoursPerWeek,
          classes: { connect: body.classIds.map(id => ({ id })) },
          lessonTeachers: {
            create: body.lessonTeachers.map(lt => ({
              teacherId: lt.teacherId,
              classId: lt.classId ?? null,
            })),
          },
        },
        include: lessonInclude,
      })
      await ensureTeachersSubject(body.lessonTeachers.map(lt => lt.teacherId))
      return res.status(201).json(formatLesson(lesson))
    }

    if (body.type === 'MULTI_TEACHER') {
      // Guard: both classes must belong to the same grade
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Multi-teacher lessons must involve exactly 2 classes from the same grade.' })
      }
      const lesson = await prisma.lesson.create({
        data: {
          type: 'MULTI_TEACHER',
          subjectId: body.subjectId,
          hoursPerWeek: body.hoursPerWeek,
          classes: { connect: body.classIds.map(id => ({ id })) },
          lessonTeachers: {
            create: body.lessonTeachers.map(lt => ({
              teacherId: lt.teacherId,
              classId: null,
            })),
          },
        },
        include: lessonInclude,
      })
      await ensureTeachersSubject(body.lessonTeachers.map(lt => lt.teacherId))
      return res.status(201).json(formatLesson(lesson))
    }
  } catch (err) { next(err) }
})

lessonsRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id   = req.params.id
    const body = lessonCreateSchema.parse(req.body)

    const ensureTeacherSubject = () =>
      prisma.teacher.update({
        where: { id: (body as any).teacherId },
        data: { subjects: { connect: [{ id: body.subjectId }] } },
      })

    const ensureTeachersSubject = async (teacherIds: string[]) => {
      await Promise.all(teacherIds.map(tid =>
        prisma.teacher.update({
          where: { id: tid },
          data: { subjects: { connect: [{ id: body.subjectId }] } },
        })
      ))
    }

    if (body.type === 'REGULAR') {
      const [classId] = body.classIds
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'REGULAR',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: null, mathLevel: null, englishLevel: null,
          classes: { set: [{ id: classId }] },
          lessonTeachers: { deleteMany: {} },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
      return res.json(formatLesson(lesson))
    }

    if (body.type === 'SHARED') {
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Shared lessons must involve exactly 2 classes from the same grade.' })
      }
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'SHARED',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: null, mathLevel: null, englishLevel: null,
          classes: { set: body.classIds.map(cid => ({ id: cid })) },
          lessonTeachers: { deleteMany: {} },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
      return res.json(formatLesson(lesson))
    }

    if (body.type === 'MATH_GROUP') {
      // Uniqueness: no OTHER lesson may share the same (grade, mathLevel)
      const conflict = await prisma.lesson.count({
        where: { type: 'MATH_GROUP', gradeId: body.gradeId, mathLevel: body.mathLevel, NOT: { id } },
      })
      if (conflict > 0) {
        return res.status(409).json({ error: `A ${body.mathLevel} math group already exists for this grade.` })
      }
      const gradeClasses = await prisma.class.findMany({ where: { gradeId: body.gradeId } })
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'MATH_GROUP',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: body.gradeId,
          mathLevel: body.mathLevel,
          englishLevel: null,
          classes: { set: gradeClasses.map(c => ({ id: c.id })) },
          lessonTeachers: { deleteMany: {} },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
      return res.json(formatLesson(lesson))
    }

    if (body.type === 'ENGLISH_GROUP') {
      const conflict = await prisma.lesson.count({
        where: { type: 'ENGLISH_GROUP', gradeId: body.gradeId, englishLevel: body.englishLevel as any, NOT: { id } },
      })
      if (conflict > 0) {
        return res.status(409).json({ error: `A ${body.englishLevel} English group already exists for this grade.` })
      }
      const gradeClasses = await prisma.class.findMany({ where: { gradeId: body.gradeId } })
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'ENGLISH_GROUP',
          subjectId: body.subjectId,
          teacherId: body.teacherId,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: body.gradeId,
          mathLevel: null,
          englishLevel: body.englishLevel as any,
          classes: { set: gradeClasses.map(c => ({ id: c.id })) },
          lessonTeachers: { deleteMany: {} },
        },
        include: lessonInclude,
      })
      await ensureTeacherSubject()
      return res.json(formatLesson(lesson))
    }

    if (body.type === 'PARALLEL') {
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Parallel lessons must involve exactly 2 classes from the same grade.' })
      }
      const validClassIds = new Set(body.classIds)
      const invalidEntry = body.lessonTeachers.find(lt => lt.classId && !validClassIds.has(lt.classId))
      if (invalidEntry) {
        return res.status(400).json({ error: 'Each teacher in a Parallel lesson must be assigned to one of the two classes.' })
      }
      // Replace LessonTeacher entries atomically: delete all, re-create
      await prisma.lessonTeacher.deleteMany({ where: { lessonId: id } })
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'PARALLEL',
          subjectId: body.subjectId,
          teacherId: null,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: null, mathLevel: null, englishLevel: null,
          classes: { set: body.classIds.map(cid => ({ id: cid })) },
          lessonTeachers: {
            create: body.lessonTeachers.map(lt => ({
              teacherId: lt.teacherId,
              classId: lt.classId ?? null,
            })),
          },
        },
        include: lessonInclude,
      })
      await ensureTeachersSubject(body.lessonTeachers.map(lt => lt.teacherId))
      return res.json(formatLesson(lesson))
    }

    if (body.type === 'MULTI_TEACHER') {
      const classes = await prisma.class.findMany({
        where: { id: { in: body.classIds } },
        include: { grade: true },
      })
      if (classes.length !== 2 || classes[0].gradeId !== classes[1].gradeId) {
        return res.status(400).json({ error: 'Multi-teacher lessons must involve exactly 2 classes from the same grade.' })
      }
      await prisma.lessonTeacher.deleteMany({ where: { lessonId: id } })
      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          type: 'MULTI_TEACHER',
          subjectId: body.subjectId,
          teacherId: null,
          hoursPerWeek: body.hoursPerWeek,
          gradeId: null, mathLevel: null, englishLevel: null,
          classes: { set: body.classIds.map(cid => ({ id: cid })) },
          lessonTeachers: {
            create: body.lessonTeachers.map(lt => ({
              teacherId: lt.teacherId,
              classId: null,
            })),
          },
        },
        include: lessonInclude,
      })
      await ensureTeachersSubject(body.lessonTeachers.map(lt => lt.teacherId))
      return res.json(formatLesson(lesson))
    }
  } catch (err) { next(err) }
})

lessonsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id

    // Delete overrides on entries first (they have ON DELETE CASCADE from entry,
    // but we're deleting from the lesson side so we need to unwind manually).
    const entryIds = (
      await prisma.scheduleEntry.findMany({ where: { lessonId: id }, select: { id: true } })
    ).map(e => e.id)

    if (entryIds.length > 0) {
      await prisma.override.deleteMany({ where: { entryId: { in: entryIds } } })
      await prisma.scheduleEntry.deleteMany({ where: { lessonId: id } })
    }

    // Delete restrictions that reference this lesson (FK is RESTRICT by default)
    await prisma.restriction.deleteMany({ where: { lessonId: id } })

    await prisma.lesson.delete({ where: { id } })
    res.status(204).send()
  } catch (err) { next(err) }
})

/** Formats a Prisma lesson (with includes) into the shared Lesson type shape */
function formatLesson(lesson: any) {
  return {
    id: lesson.id,
    type: lesson.type,
    subjectId: lesson.subjectId,
    teacherId: lesson.teacherId ?? null,
    hoursPerWeek: lesson.hoursPerWeek,
    classIds: lesson.classes.map((c: any) => c.id),
    gradeId: lesson.gradeId,
    mathLevel: lesson.mathLevel,
    englishLevel: lesson.englishLevel,
    lessonTeachers: (lesson.lessonTeachers ?? []).map((lt: any) => ({
      teacherId: lt.teacherId,
      classId: lt.classId ?? null,
    })),
    subject: lesson.subject,
    teacher: lesson.teacher ? { id: lesson.teacher.id, name: lesson.teacher.name } : null,
    classes: lesson.classes,
    grade: lesson.grade,
    createdAt: lesson.createdAt,
  }
}
