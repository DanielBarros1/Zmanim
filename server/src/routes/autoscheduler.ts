/**
 * Auto-scheduler routes
 *
 * POST /api/schedules/auto          → start a new AS job → returns { jobId }
 * GET  /api/schedules/auto/jobs/:jobId → poll job status
 *
 * The AS runs in a Node.js worker thread (see services/autoscheduler.ts).
 * Jobs are tracked in-memory (fine for 1–2 concurrent admin users).
 * On completion a new DRAFT Schedule is created in the DB.
 */

import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { startAutoSchedulerJob, getJob } from '../services/autoscheduler'

export const autoschedulerRouter = Router()

autoschedulerRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      seedScheduleId: z.string().uuid().optional(),
      config: z.object({
        nRestarts: z.number().int().min(1).max(200).default(50),
        nIterations: z.number().int().min(100).max(10000).default(1000),
      }).optional(),
    }).parse(req.body)

    const jobId = uuid()
    // Fire and forget — job runs in worker thread
    startAutoSchedulerJob({
      jobId,
      name: body.name,
      seedScheduleId: body.seedScheduleId,
      nRestarts: body.config?.nRestarts ?? 50,
      nIterations: body.config?.nIterations ?? 1000,
    })

    res.status(202).json({ jobId })
  } catch (err) { next(err) }
})

autoschedulerRouter.get('/jobs/:jobId', requireAuth, (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json(job)
})
