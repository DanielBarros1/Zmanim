/**
 * Auth routes
 *
 * GET  /auth/google           → redirect to Google consent screen
 * GET  /auth/google/callback  → Passport callback → redirect to client
 * GET  /auth/me               → return current user (or 401)
 * POST /auth/logout           → destroy session
 */

import { Router } from 'express'
import passport from 'passport'
import { requireAuth } from '../middleware/auth'

export const authRouter = Router()

authRouter.get('/google', passport.authenticate('google', {
  scope: ['email', 'profile'],
}))

authRouter.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/login?error=unauthorized`,
  }),
  (_req, res) => {
    // Successful login → send to home
    res.redirect(process.env.CLIENT_URL ?? 'http://localhost:5173')
  },
)

authRouter.get('/me', requireAuth, (req, res) => {
  const user = req.user as any
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    teacherId: user.teacherId ?? null,
  })
})

authRouter.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err)
    req.session.destroy(() => {
      res.clearCookie('connect.sid')
      res.json({ ok: true })
    })
  })
})
