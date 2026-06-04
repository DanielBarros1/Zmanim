/**
 * School config routes
 *
 * GET /api/config      → get current school config (creates default if none exists)
 * PUT /api/config      → update school config
 */

import { Router } from 'express'
import { z } from 'zod'
import { Day } from '@prisma/client'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const configRouter = Router()

// Default config used on first run
const DEFAULT_CONFIG = {
  dayStartTime: '08:00',
  lessonDuration: 75,
  slotsPerDay: 4,
  recesses: [
    { afterSlot: 1, durationMinutes: 15 },
    { afterSlot: 2, durationMinutes: 20 },
    { afterSlot: 3, durationMinutes: 10 },
  ],
  workDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'] as Day[],
  subjectTwicePerDayAllowed: [] as string[],
}

const recessSchema = z.object({
  afterSlot: z.number().int().min(1),
  durationMinutes: z.number().int().min(1),
})

// Full schema used for validation; all fields are optional so the PATCH endpoint
// can accept partial updates (e.g. updating only subjectTwicePerDayAllowed without
// re-sending the entire config form).
const configSchema = z.object({
  dayStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lessonDuration: z.number().int().min(30).max(120).optional(),
  slotsPerDay: z.number().int().min(1).max(10).optional(),
  recesses: z.array(recessSchema).optional(),
  workDays: z.array(z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'])).optional(),
  // Subject IDs exempt from the "no same subject twice per day" hard invariant (D7).
  // Send only this field from the Restrictions page without touching the rest.
  subjectTwicePerDayAllowed: z.array(z.string().uuid()).optional(),
})

configRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    let config = await prisma.schoolConfig.findFirst()
    if (!config) {
      // Create default on first access
      config = await prisma.schoolConfig.create({ data: DEFAULT_CONFIG })
    }
    res.json(config)
  } catch (err) {
    next(err)
  }
})

configRouter.patch('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = configSchema.parse(req.body)
    // Strip undefined values — only update what was actually sent.
    // This lets callers send partial updates (e.g. just subjectTwicePerDayAllowed)
    // without accidentally resetting other fields.
    const data = Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== undefined)
    )
    let config = await prisma.schoolConfig.findFirst()
    if (!config) {
      config = await prisma.schoolConfig.create({ data: { ...DEFAULT_CONFIG, ...data } })
    } else {
      config = await prisma.schoolConfig.update({ where: { id: config.id }, data })
    }
    res.json(config)
  } catch (err) {
    next(err)
  }
})
