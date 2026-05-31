# Zmanim — TODO & Feature Backlog

> Last updated: 2026-05-31 (session 8)
> This file is the source of truth for all pending work. Update it at the end of every session.

---

## ✅ Recently Completed (session 8 — 2026-05-31)

- **Landing page** — `/` now shows stat cards (classes/teachers/subjects/rooms/lessons/placed%/violations) + embedded compact schedule table with selector. Old home moved to `/schedules`.
- **Compact view axis flip** — grades as columns, day×slot as rows. Cells 72px wide, full subject names.
- **GitHub Actions deploy** — pushes to `main` auto-deploy via SSH + `docker compose up -d --build`.
- **Pre-push validation hook** — `.claude/pre-push-check.sh` blocks git push if `shared build`, `client tsc -b`, or `server tsc` fail. Mirrors Docker exactly.
- **CLAUDE.md + README** — comprehensive documentation for cold-start onboarding.
- **Email allowlist** — `ALLOWED_EMAILS` env var in `passport.ts`; comma-separated, case-insensitive. Replaces the per-SSH `.env` edit workflow.
- **Delete published schedule** — server guard removed; client shows stronger warning + error handling.
- **Auto-scheduler all-placed guarantee** — 3-layer defence: count-based seed exclusion, per-restart check, Gate 3 finalization check.
- **Production deployment** — live at `https://zmanim.duckdns.org`. Google OAuth working.
- **Quick-Fix Suggestions, Drag Tooltip, Undo/Redo, Teacher Availability Grid, Google OAuth** — all complete.

---

## 🔨 Next Up — User Management Page

**Status:** Designed, not yet built. Start here next session.

### Architecture

- New Prisma model `AllowedEmail { id, email, invitedBy, createdAt }` 
- `ALLOWED_EMAILS` env var = root users (always allowed in, can manage others)
- Login flow in `passport.ts`: allow if email in `ALLOWED_EMAILS` env OR in `AllowedEmail` DB table
- Root check: `req.user.email` in `ALLOWED_EMAILS.split(',')` — expose as `isRoot: boolean` on `/auth/me`
- `requireRoot` middleware for user-management routes

### Server changes
- `server/prisma/schema.prisma`: add `AllowedEmail` model
- `server/src/middleware/passport.ts`: expand login check to also query `AllowedEmail` table
- `server/src/middleware/requireRoot.ts`: new middleware
- `server/src/routes/users.ts`: new router
  - `GET /api/users` — list all `User` records + their `AllowedEmail` status
  - `POST /api/users/invite` — add email to `AllowedEmail` (requireRoot)
  - `DELETE /api/users/:id` — remove from `AllowedEmail` + optionally revoke session (requireRoot)

### Client changes
- `client/src/api/users.ts` — `useUsers()`, `useInviteUser()`, `useRevokeUser()` hooks
- `client/src/pages/UsersPage.tsx` — table of users + invite form, root-only
- `shared/src/entities.ts` — add `isRoot: boolean` to `AuthUser`
- `client/src/App.tsx` — add `/users` route
- `client/src/components/layout/Sidebar.tsx` — add Users link (only shown if `user.isRoot`)
- `client/src/api/auth.ts` — `useCurrentUser()` returns `isRoot`

### Schema migration note
This requires a DB schema change. Before deploying:
1. Run `npx prisma migrate dev --name add_allowed_email` locally
2. Commit migration files
3. On server: `docker compose exec zmanim-server npx prisma migrate deploy` (NOT db push)

---

## Feature Backlog

### 1. XLSX Exporter
Export the published schedule to Excel. Format TBD — needs a decision on layout (one sheet per grade? per teacher? one big matrix?) before implementation.

### 2. ~~Teacher Availability Batch Editor~~ ✅ Done

### 3. ~~Quick-Fix Suggestions~~ ✅ Done (v1 — 10 of 20 types; remaining 10 return "no fix found")

### 4. Per-Class Timetable Print / Export
Bulk-generate one clean A4 timetable per class (Mon–Thu × slots, with subject/teacher/room per cell). All 12 classes in one PDF. Saves the admin from manually building these in Excel every semester.

### 5. ~~Drag-Conflict Nudge Tooltip~~ ✅ Done

### 6. Teacher Personal Schedule Link (Milestone 2)
A read-only URL (`/teacher/{token}`) showing a teacher's own weekly timetable from the published schedule. No login required, mobile-friendly, always reflects the latest published version. Teachers currently get a PDF by email — a live link means they always see the current state. This is Milestone 2 from the original spec.

---

## 💡 Ideas to Workshop

### Teacher Workload Dashboard
A dedicated view showing each teacher's assigned hours this week vs. their target hours (a new `targetHours` field on the Teacher model), color-coded: green = on target, amber = ±1, red = over/under. Currently admins count this manually. Needs UX design before committing to an approach.

---

## Production Blockers

- [ ] **Prisma migration history** — all schema changes used `db push` (dev shortcut). The User Management feature (next up) will be the first to use proper `prisma migrate dev` + `migrate deploy` workflow. See migration note in the User Management section above.

---

## Minor Cleanup

- [ ] Remove dead `gradeMap` comment in `CompactViewPage`
- [ ] Keyboard accessibility audit — tab order through grid, focus management in modals
