/**
 * Auth routes
 *
 * GET  /auth/google           → redirect to Google consent screen
 * GET  /auth/google/callback  → Passport callback → redirect to client
 * GET  /auth/me               → return current user (or 401)
 * POST /auth/logout           → destroy session
 *
 * DEV ONLY:
 * GET  /auth/dev-login        → instantly creates/logs in a dev admin account,
 *                               bypassing Google OAuth. Only active when
 *                               NODE_ENV !== 'production'.
 */

import { Router } from 'express'
import passport from 'passport'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../db'

export const authRouter = Router()

// ─── Dev login bypass (development only) ──────────────────────

authRouter.get('/dev-login', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    // Upsert a fixed dev admin account so migrations don't need seed data
    const devUser = await prisma.user.upsert({
      where: { email: 'dev@zmanim.local' },
      update: {},
      create: {
        email: 'dev@zmanim.local',
        name: 'Dev Admin',
        googleId: 'dev-local',
        role: 'ADMIN',
      },
    })

    req.login(devUser, (err) => {
      if (err) return next(err)
      // Redirect to the client app after session is established
      res.redirect(process.env.CLIENT_URL ?? 'http://localhost:5173')
    })
  } catch (err) {
    next(err)
  }
})

// ─── Google OAuth ──────────────────────────────────────────────

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
