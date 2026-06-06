/**
 * GET /api/logs — server log viewer.
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
 * Access — two paths:
 *   1. Browser session: requireAuth + requireRoot (ALLOWED_EMAILS env)
 *   2. Bearer token:    Authorization: Bearer <LOG_API_KEY>
 *      Used by Claude Code / curl for autonomous log access without a browser session.
 *      Set LOG_API_KEY in the server's .env.  Never commit the key to git.
 */

import { Request, Response, NextFunction, Router } from 'express'
import { isRootEmail } from '../middleware/requireRoot'
import { getRecentLogs, getBufferSize } from '../services/logBuffer'

export const logsRouter = Router()

/** Combined auth check: valid root session OR correct LOG_API_KEY bearer token. */
function requireLogAccess(req: Request, res: Response, next: NextFunction): void {
  // Path 1 — authenticated root session (web UI)
  const user = req.user as any
  if (req.isAuthenticated() && user && isRootEmail(user?.email ?? '')) {
    next()
    return
  }

  // Path 2 — LOG_API_KEY bearer token (programmatic / Claude Code)
  const apiKey = process.env.LOG_API_KEY
  if (apiKey) {
    const auth = req.headers['authorization'] ?? ''
    if (auth === `Bearer ${apiKey}`) {
      next()
      return
    }
  }

  res.status(403).json({ error: 'Access denied. Valid root session or LOG_API_KEY bearer token required.' })
}

logsRouter.get('/', requireLogAccess, (req, res) => {
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
