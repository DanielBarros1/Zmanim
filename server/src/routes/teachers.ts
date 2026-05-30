/**
 * Teachers routes — CRUD with subject assignments
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const teachersRouter = Router()

teachersRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const teachers = await prisma.teacher.findMany({
      include: { subjects: true },
      orderBy: { name: 'asc' },
    })
    // Return a clean shape matching the shared Teacher type
    res.json(teachers.map(t => ({
      id: t.id,
      name: t.name,
      subjectIds: t.subjects.map(s => s.id),
      createdAt: t.createdAt,
    })))
  } catch (err) { next(err) }
})

const teacherSchema = z.object({
  name: z.string().min(1),
  subjectIds: z.array(z.string().uuid()).default([]),
})

teachersRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, subjectIds } = teacherSchema.parse(req.body)
    const teacher = await prisma.teacher.create({
      data: {
        name,
        subjects: { connect: subjectIds.map(id => ({ id })) },
      },
      include: { subjects: true },
    })
    res.status(201).json({ ...teacher, subjectIds: teacher.subjects.map(s => s.id) })
  } catch (err) { next(err) }
})

teachersRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, subjectIds } = teacherSchema.partial().parse(req.body)
    const teacher = await prisma.teacher.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(subjectIds !== undefined && {
          // Replace the subject list entirely
          subjects: { set: subjectIds.map(id => ({ id })) },
        }),
      },
      include: { subjects: true },
    })
    res.json({ ...teacher, subjectIds: teacher.subjects.map(s => s.id) })
  } catch (err) { next(err) }
})

teachersRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id

    // Null out any User.teacherId references (User → Teacher is nullable)
    await prisma.user.updateMany({ where: { teacherId: id }, data: { teacherId: null } })

    // Delete teacher-scoped restrictions
    await prisma.restriction.deleteMany({ where: { teacherId: id } })

    // Cascade-delete lessons: overrides → entries → lesson-restrictions → lessons
    const lessonIds = (
      await prisma.lesson.findMany({ where: { teacherId: id }, select: { id: true } })
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

    await prisma.teacher.delete({ where: { id } })
    res.status(204).send()
  } catch (err) { next(err) }
})

/**
 * POST /api/teachers/backfill-subjects
 *
 * One-shot utility: inspects every lesson in the DB and ensures
 * the lesson's teacher is connected to the lesson's subject.
 * Safe to run multiple times (connect is idempotent).
 */
teachersRouter.post('/backfill-subjects', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const lessons = await prisma.lesson.findMany({ select: { teacherId: true, subjectId: true } })
    const map = new Map<string, Set<string>>()
    for (const l of lessons) {
      if (!l.teacherId) continue  // PARALLEL/MULTI_TEACHER have no primary teacher
      if (!map.has(l.teacherId)) map.set(l.teacherId, new Set())
      map.get(l.teacherId)!.add(l.subjectId)
    }
    let updated = 0
    for (const [teacherId, subjectIds] of map) {
      await prisma.teacher.update({
        where: { id: teacherId },
        data: { subjects: { connect: [...subjectIds].map(id => ({ id })) } },
      })
      updated++
    }
    res.json({ updated })
  } catch (err) { next(err) }
})
