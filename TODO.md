# Zmanim — TODO & Feature Backlog

> Last updated: 2026-05-31 (session 9)
> This file is the source of truth for all pending work. Update it at the end of every session.

---

## ✅ Recently Completed (session 9 — 2026-05-31)

- **User Management page** — `/users` route, root-only. Invite users by email, revoke access, see who's signed in. Root users (ALLOWED_EMAILS env) shown separately and cannot be revoked via UI.
- **AllowedEmail DB table** — Prisma migration established (`20260531120000_add_allowed_email`). First real migration; initial schema baselined, migration history now active.
- **Two-tier login flow** — passport now checks ALLOWED_EMAILS env (root) OR AllowedEmail table (invited). If neither matches, access is denied.
- **`isRoot` on AuthUser** — derived from env at request time, exposed via `/auth/me`, used to conditionally show Admin sidebar section and guard UsersPage.
- **`requireRoot` middleware** — `server/src/middleware/requireRoot.ts`. All user-management routes protected.

## ✅ Recently Completed (session 8 — 2026-05-31)

- **Landing page** — `/` now shows stat cards (classes/teachers/subjects/rooms/lessons/placed%/violations) + embedded compact schedule table with selector. Old home moved to `/schedules`.
- **Compact view axis flip** — grades as columns, day×slot as rows. Cells 72px wide, full subject names.
- **GitHub Actions deploy** — pushes to `main` auto-deploy via SSH + `docker compose up -d --build`.
- **Pre-push validation hook** — `.claude/pre-push-check.sh` blocks git push if `shared build`, `client tsc -b`, or `server tsc` fail. Mirrors Docker exactly.
- **CLAUDE.md + README** — comprehensive documentation for cold-start onboarding.
- **Email allowlist** — `ALLOWED_EMAILS` env var in `passport.ts`; comma-separated, case-insensitive. Replaces the per-SSH `.env` edit workflow.

---

## 🔨 Next Up — Production Deploy of User Management

Before the new user management code goes live, the production server needs its migration history bootstrapped:

```bash
# SSH into server or exec into container
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml exec zmanim-server sh

# Inside container — establish migration baseline (schema already there via db push)
npx prisma migrate resolve --applied 20260101000000_initial_schema

# Run the new AllowedEmail migration
npx prisma migrate deploy
```

After deploying the new Docker image (via GitHub Actions push to main), run the above commands once.

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

## Minor Cleanup

- [ ] Remove dead `gradeMap` comment in `CompactViewPage`
- [ ] Keyboard accessibility audit — tab order through grid, focus management in modals
