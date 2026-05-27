/**
 * Auth middleware
 *
 * requireAuth   — 401 if no active session
 * requireAdmin  — 403 if user is not ADMIN
 *
 * Usage:
 *   router.get('/protected', requireAuth, handler)
 *   router.post('/admin-only', requireAuth, requireAdmin, handler)
 */

import { Request, Response, NextFunction } from 'express'

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any
  if (user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  next()
}
