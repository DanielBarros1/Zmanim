/**
 * Zmanim — Express app entry point
 *
 * Wires together:
 * - Session + Passport (Google OAuth)
 * - CORS (client dev server on :5173)
 * - All route modules
 */

import 'dotenv/config'
import express from 'express'
import path from 'path'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import passport from 'passport'
import cors from 'cors'

import { configurePassport } from './middleware/passport'
import { authRouter } from './routes/auth'
import { configRouter } from './routes/config'
import { subjectsRouter } from './routes/subjects'
import { roomsRouter } from './routes/rooms'
import { teachersRouter } from './routes/teachers'
import { gradesRouter, classesRouter } from './routes/grades'
import { lessonsRouter } from './routes/lessons'
import { restrictionsRouter } from './routes/restrictions'
import { schedulesRouter } from './routes/schedules'
import { entriesRouter } from './routes/entries'
import { autoschedulerRouter } from './routes/autoscheduler'
import { importRouter } from './routes/import'

const app = express()
const PORT = process.env.PORT ?? 3001

// Trust Caddy / any reverse proxy sitting in front of us.
// Required so session cookies with secure:true work correctly — without this,
// Express thinks the connection is plain HTTP and refuses to set Secure cookies.
app.set('trust proxy', 1)

// ─── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true, // required for session cookies
}))

// ─── Body parsing ─────────────────────────────────────────────
app.use(express.json())

// ─── Sessions (stored in Postgres) ────────────────────────────
const PgSession = connectPgSimple(session)
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  },
}))

// ─── Passport ─────────────────────────────────────────────────
configurePassport()
app.use(passport.initialize())
app.use(passport.session())

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth', authRouter)
app.use('/api/config', configRouter)
app.use('/api/subjects', subjectsRouter)
app.use('/api/rooms', roomsRouter)
app.use('/api/teachers', teachersRouter)
app.use('/api/grades', gradesRouter)
app.use('/api/classes', classesRouter)
app.use('/api/lessons', lessonsRouter)
app.use('/api/restrictions', restrictionsRouter)
app.use('/api/schedules', schedulesRouter)
app.use('/api/schedules', entriesRouter)       // /api/schedules/:id/entries
app.use('/api/schedules/auto', autoschedulerRouter)
app.use('/api/import', importRouter)

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ─── Static files (production only) ───────────────────────────
// In production the built React app lives at client/dist relative to the
// repo root.  Express serves it here so Caddy only needs to reverse-proxy
// to this one process — no separate static-file volume mount required.
// Must be AFTER all API/auth routes so the SPA catch-all doesn't shadow them.
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../client/dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Zmanim server running on http://localhost:${PORT}`)
})

export default app
