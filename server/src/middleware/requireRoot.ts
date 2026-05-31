/**
 * requireRoot middleware
 *
 * Allows only users whose email is in the ALLOWED_EMAILS env var.
 * These "root" users are the only ones permitted to manage the user list
 * (invite new users, revoke access).
 *
 * Must be used AFTER requireAuth (root check reads req.user).
 *
 * Usage:
 *   router.get('/users', requireAuth, requireRoot, handler)
 */

import { Request, Response, NextFunction } from 'express'

/** Returns the list of root emails from ALLOWED_EMAILS env (normalised to lowercase). */
export function getRootEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

/** True if the given email is a root user. */
export function isRootEmail(email: string): boolean {
  return getRootEmails().includes(email.toLowerCase())
}

/** Express middleware — 403 if the authenticated user is not a root user. */
export function requireRoot(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any
  if (!isRootEmail(user?.email ?? '')) {
    res.status(403).json({ error: 'Root access required. Only root users can manage the user list.' })
    return
  }
  next()
}
