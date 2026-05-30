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
}

const recessSchema = z.object({
  afterSlot: z.number().int().min(1),
  durationMinutes: z.number().int().min(1),
})

const configSchema = z.object({
  dayStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  lessonDuration: z.number().int().min(30).max(120),
  slotsPerDay: z.number().int().min(1).max(10),
  recesses: z.array(recessSchema),
  workDays: z.array(z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'])),
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
    const data = configSchema.parse(req.body)
    let config = await prisma.schoolConfig.findFirst()
    if (!config) {
      config = await prisma.schoolConfig.create({ data })
    } else {
      config = await prisma.schoolConfig.update({ where: { id: config.id }, data })
    }
    res.json(config)
  } catch (err) {
    next(err)
  }
})
