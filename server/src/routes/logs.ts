/**
 * GET /api/logs — server log viewer for root users.
 *
 * Returns recent lines from the in-process log buffer (stdout + stderr).
 * Logs are ephemeral: they reset when the container restarts.
 *
 * Query params:
 *   lines  (number, default 200, max 1000)   — how many lines to return (tail)
 *   filter (string)                           — case-insensitive substring match
 *   level  ("log" | "error")                  — filter by stream (stdout / stderr)
 *
 * Response: { entries: LogEntry[], bufferedTotal: number }
 *
 * Access: requireAuth + requireRoot (ALLOWED_EMAILS env)
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireRoot } from '../middleware/requireRoot'
import { getRecentLogs, getBufferSize } from '../services/logBuffer'

export const logsRouter = Router()

logsRouter.get('/', requireAuth, requireRoot, (req, res) => {
  const lines  = Math.min(Number(req.query.lines) || 200, 1000)
  const filter = typeof req.query.filter === 'string' ? req.query.filter.trim() : undefined
  const level  = req.query.level === 'log' || req.query.level === 'error'
    ? (req.query.level as 'log' | 'error')
    : undefined

  const entries = getRecentLogs({
    lines,
    filter: filter || undefined,
    level,
  })

  res.json({ entries, bufferedTotal: getBufferSize() })
})
