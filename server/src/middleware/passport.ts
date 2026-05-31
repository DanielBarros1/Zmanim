/**
 * Passport.js configuration — Google OAuth 2.0
 *
 * On successful login:
 * 1. Checks email against the ALLOWED_EMAILS allowlist (if set)
 * 2. Upserts the User record in Postgres (create on first login, update name/picture on subsequent)
 * 3. Stores user.id in the session (serialization)
 *
 * Access control env vars (set in server/.env):
 *
 *   ALLOWED_EMAILS=alice@gmail.com,bob@gmail.com
 *     Comma-separated list of Google accounts permitted to log in.
 *     If empty or unset, any Google account can log in.
 *
 *   ALLOWED_EMAIL_DOMAIN=example.edu
 *     Legacy domain-based restriction. If set, only emails ending in
 *     @example.edu are allowed (takes effect alongside ALLOWED_EMAILS).
 *     Leave empty unless you want Google Workspace domain restriction.
 */

import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { prisma } from '../db'

export function configurePassport() {
  // Skip Google OAuth strategy setup when credentials are not configured.
  // This allows the dev-login bypass to work without Google credentials.
  const clientID = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (clientID && clientSecret) {
    passport.use(new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/auth/google/callback',
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value

          if (!email) {
            return done(null, false, { message: 'No email returned from Google' })
          }

          // ── Email allowlist ────────────────────────────────────────────
          // ALLOWED_EMAILS is a comma-separated list of permitted addresses.
          // If the env var is set and non-empty, only those exact emails can
          // log in. Unknown accounts are rejected before touching the DB.
          const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean)

          if (allowedEmails.length > 0 && !allowedEmails.includes(email.toLowerCase())) {
            return done(null, false, { message: 'Your account is not authorised to access this app.' })
          }

          // ── Legacy domain restriction ──────────────────────────────────
          const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? ''
          if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
            return done(null, false, {
              message: `Login restricted to @${allowedDomain} accounts`,
            })
          }

          const picture = profile.photos?.[0]?.value ?? null

          // Upsert user — create on first login, update name/picture if changed
          const user = await prisma.user.upsert({
            where: { googleId: profile.id },
            update: { name: profile.displayName, email, picture },
            create: {
              googleId: profile.id,
              email,
              name: profile.displayName,
              picture,
              role: 'ADMIN',
            },
          })

          return done(null, user)
        } catch (err) {
          return done(err as Error)
        }
      },
    ))
  } else {
    console.warn('[Passport] GOOGLE_CLIENT_ID not set — Google OAuth disabled. Use /auth/dev-login in development.')
  }

  // Store only the user ID in the session cookie — hydrate from DB on each request
  passport.serializeUser((user: any, done) => {
    done(null, user.id)
  })

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } })
      done(null, user ?? false)
    } catch (err) {
      done(err)
    }
  })
}
