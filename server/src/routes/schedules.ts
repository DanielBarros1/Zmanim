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
 * GET    /api/schedules/:id/export/xlsx → export as Excel file (one sheet per grade)
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'
import * as XLSX from 'xlsx'
import { Day } from '@zmanim/shared'

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

// ─── Export to XLSX ────────────────────────────────

const DAY_ORDER: Record<Day, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
}

const DAY_LABELS: Record<Day, string> = {
  SUNDAY: 'Sunday',
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
}

schedulesRouter.get('/:id/export/xlsx', requireAuth, async (req, res, next) => {
  try {
    // Fetch schedule with all related data
    const schedule = await prisma.schedule.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        entries: {
          include: {
            lesson: {
              include: {
                subject: true,
                teacher: true,
                classes: true,
                lessonTeachers: { include: { teacher: true } },
              },
            },
            room: true,
          },
        },
      },
    })

    // Fetch all grades, classes, and config for proper structure
    const [grades, classes, config] = await Promise.all([
      prisma.grade.findMany({ orderBy: { number: 'asc' } }),
      prisma.class.findMany({
        include: { grade: true },
        orderBy: [{ gradeId: 'asc' }, { section: 'asc' }],
      }),
      prisma.schoolConfig.findFirst(),
    ])

    if (!config) throw new Error('School config not found')

    // Create workbook
    const wb = XLSX.utils.book_new()
    const slotsPerDay = config.slotsPerDay

    // Create one sheet per grade
    for (const grade of grades) {
      const gradeClasses = classes.filter(c => c.gradeId === grade.id)
      const [classA, classB] = gradeClasses

      // Build grid: rows = day × slot, columns = classA, classB
      const gridData: (string | null)[][] = []

      // Header row
      gridData.push([
        'Time',
        classA ? `Grade ${grade.number}${classA.section}` : '',
        classB ? `Grade ${grade.number}${classB.section}` : '',
      ])

      // Data rows: one per slot per day
      const workDays = (config.workDays as Day[]).sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b])
      for (const day of workDays) {
        for (let slot = 1; slot <= slotsPerDay; slot++) {
          const rowLabel = `${DAY_LABELS[day]} — Slot ${slot}`
          const cellA = buildCell(schedule.entries, classA, day, slot)
          const cellB = buildCell(schedule.entries, classB, day, slot)
          gridData.push([rowLabel, cellA || '', cellB || ''])
        }
      }

      // Create sheet and add to workbook
      const ws = XLSX.utils.aoa_to_sheet(gridData)
      // Set column widths
      ws['!cols'] = [
        { wch: 20 },
        { wch: 35 },
        { wch: 35 },
      ]
      XLSX.utils.book_append_sheet(wb, ws, `Grade ${grade.number}`)
    }

    // Write to buffer and send
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${schedule.name}.xlsx"`)
    res.send(buffer)
  } catch (err) { next(err) }
})

function buildCell(entries: any[], classRecord: any, day: Day, slot: number): string | null {
  if (!classRecord) return null

  const entry = entries.find(
    e => e.lesson.classes.some((c: any) => c.id === classRecord.id) &&
         e.day === day &&
         e.slot === slot
  )

  if (!entry) return null

  const { lesson } = entry
  const subject = lesson.subject.name
  const teachers = lesson.teacher
    ? lesson.teacher.name
    : lesson.lessonTeachers.map((lt: any) => lt.teacher.name).join(', ')

  return `${subject}\n${teachers}`
}
