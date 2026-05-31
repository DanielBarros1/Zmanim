/**
 * Passport.js configuration — Google OAuth 2.0
 *
 * On successful login:
 * 1. Verifies email domain against ALLOWED_EMAIL_DOMAIN env var
 * 2. Upserts the User record in Postgres (create on first login, update name on subsequent)
 * 3. Stores user.id in the session (serialization)
 *
 * The ALLOWED_EMAIL_DOMAIN env var controls which Google Workspace is permitted.
 * Set to e.g. "ankori.edu" to restrict login to school accounts.
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
          const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN

          if (!email) {
            return done(null, false, { message: 'No email returned from Google' })
          }

          // Domain restriction — enforce school Google Workspace
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
