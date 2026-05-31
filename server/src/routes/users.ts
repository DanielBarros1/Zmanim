/**
 * User management routes — root-only
 *
 * GET    /api/users          — list all users (root users + invited users)
 * POST   /api/users/invite   — invite a new user by email
 * DELETE /api/users/:id      — revoke an invited user's access
 *
 * All routes require authentication AND root access (email in ALLOWED_EMAILS env).
 * Root users themselves cannot be removed via the API — edit ALLOWED_EMAILS env to do that.
 *
 * Response shape for GET /api/users: UserListItem[] (see shared/src/entities.ts)
 *   - Root users: isRoot=true, allowedEmailId=null — sourced from env var
 *   - Invited users: isRoot=false, allowedEmailId=AllowedEmail.id — sourced from DB
 *   - userId/name/picture populated once the person has signed in at least once
 */

import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { requireRoot, getRootEmails } from '../middleware/requireRoot'
import { prisma } from '../db'

export const usersRouter = Router()

// ─── GET /api/users ───────────────────────────────────────────
// Returns two groups merged into one array:
//   1. Root users from ALLOWED_EMAILS env (always present, cannot be deleted)
//   2. Invited users from AllowedEmail table
// Each item includes the matching User record if the person has signed in.

usersRouter.get('/', requireAuth, requireRoot, async (req, res, next) => {
  try {
    const rootEmails = getRootEmails()

    // Fetch all invite records from the DB
    const allowedEmailRecords = await prisma.allowedEmail.findMany({
      orderBy: { createdAt: 'asc' },
    })

    // Collect every email we care about so we can batch-fetch User records
    const invitedEmails = allowedEmailRecords.map(ae => ae.email)
    const allEmails = [...rootEmails, ...invitedEmails]

    // Lookup matching User records (signed-in accounts) — keyed by lowercase email
    const signedInUsers = await prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { id: true, email: true, name: true, picture: true },
    })
    const userByEmail: Record<string, typeof signedInUsers[0]> = {}
    for (const u of signedInUsers) {
      userByEmail[u.email.toLowerCase()] = u
    }

    // Build root user entries (sourced from env, no DB record)
    const rootItems = rootEmails.map(email => {
      const u = userByEmail[email]
      return {
        email,
        isRoot: true,
        allowedEmailId: null,
        invitedBy: null,
        invitedAt: null,
        userId: u?.id ?? null,
        name: u?.name ?? null,
        picture: u?.picture ?? null,
      }
    })

    // Build invited user entries (from AllowedEmail table).
    // Skip any emails that are ALSO in the root list — they're already covered above.
    const invitedItems = allowedEmailRecords
      .filter(ae => !rootEmails.includes(ae.email.toLowerCase()))
      .map(ae => {
        const u = userByEmail[ae.email.toLowerCase()]
        return {
          email: ae.email,
          isRoot: false,
          allowedEmailId: ae.id,
          invitedBy: ae.invitedBy,
          invitedAt: ae.createdAt.toISOString(),
          userId: u?.id ?? null,
          name: u?.name ?? null,
          picture: u?.picture ?? null,
        }
      })

    res.json([...rootItems, ...invitedItems])
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/users/invite ───────────────────────────────────
// Add an email to the AllowedEmail table.
// The person can log in via Google OAuth once this record exists.
// If the email is already in the table, returns 409 Conflict.
// If the email is a root user, returns 409 (they don't need an invite).

usersRouter.post('/invite', requireAuth, requireRoot, async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email('Must be a valid email address.'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid email address.' })
      return
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase()

    // Root users are already allowed — inviting them is a no-op and confusing
    if (getRootEmails().includes(normalizedEmail)) {
      res.status(409).json({ error: 'This email is already a root user and does not need an invite.' })
      return
    }

    const currentUser = req.user as any

    // Upsert: if already invited, treat as success (idempotent)
    const existing = await prisma.allowedEmail.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      res.status(409).json({ error: 'This email has already been invited.' })
      return
    }

    const record = await prisma.allowedEmail.create({
      data: {
        email: normalizedEmail,
        invitedBy: currentUser.email,
      },
    })

    res.status(201).json({
      allowedEmailId: record.id,
      email: record.email,
      invitedBy: record.invitedBy,
      invitedAt: record.createdAt.toISOString(),
    })
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/users/:id ────────────────────────────────────
// Remove an AllowedEmail record by its ID.
// The user's existing session is NOT invalidated (they stay logged in until
// their next login attempt, when passport will reject them).
// Root users cannot be removed this way — edit ALLOWED_EMAILS env instead.

usersRouter.delete('/:id', requireAuth, requireRoot, async (req, res, next) => {
  try {
    const { id } = req.params

    await prisma.allowedEmail.delete({ where: { id } })
    res.json({ ok: true })
  } catch (err: any) {
    // P2025 = record not found
    if (err?.code === 'P2025') {
      res.status(404).json({ error: 'User not found.' })
      return
    }
    next(err)
  }
})
