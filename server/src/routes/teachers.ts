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
    const inUse = await prisma.lesson.count({ where: { teacherId: req.params.id } })
    if (inUse > 0) {
      res.status(409).json({ error: 'Teacher is assigned to lessons and cannot be deleted.' })
      return
    }
    await prisma.teacher.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) { next(err) }
})
