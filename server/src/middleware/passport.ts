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
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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

        // Upsert user — create on first login, update name if it changed
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: { name: profile.displayName, email },
          create: {
            googleId: profile.id,
            email,
            name: profile.displayName,
            // First user ever gets ADMIN role. Subsequent users get ADMIN by default
            // and can be demoted to TEACHER by an existing admin.
            role: 'ADMIN',
          },
        })

        return done(null, user)
      } catch (err) {
        return done(err as Error)
      }
    },
  ))

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
