# Zmanim — TODO & Feature Backlog

> Last updated: 2026-06-18 (session 10)
> This file is the source of truth for all pending work. Update it at the end of every session.

---

## ✅ Recently Completed (session 10 — 2026-06-18)

- **XLSX Exporter** — `GET /api/schedules/:id/export/xlsx`. Exports schedule as Excel workbook with one sheet per grade (rows = day×slot, columns = class A/B). Client-side button on HomePage schedule cards. Uses xlsx library.
- **T2** — Day labels visibility improved. Active day tab now shows accent color background + larger font + border emphasis.
- **T3** — Roomless lessons already fully implemented (schema, UI, auto-scheduler all working).
- **T4** — Small room capacity tiers. Added `isSmall` flag to Room + `allowSmallRoom` to Lesson. Auto-scheduler respects flags in room allocator. Migration included.
- **T5** — Day-level toggle buttons in teacher availability modal. Click day buttons to mark/clear all slots in that day at once.
- **T7** — Room availability in modal. RoomPopover now shows free rooms first, occupied rooms grayed out with warnings.
- **T8** — Fixed violation count bug in StatsBar (was subtracting overridden count incorrectly).
- **T9** — Art room reservation. Added `isArtRoom` flag to Room. Auto-scheduler respects flag in room allocator.

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

### 1. ~~XLSX Exporter~~ ✅ Done (session 10 — one sheet per grade)

### 2. ~~Teacher Availability Batch Editor~~ ✅ Done

### 3. ~~Quick-Fix Suggestions~~ ✅ Done (v1 — 10 of 20 types; remaining 10 return "no fix found")

### 3. Per-Class Timetable Print / Export
Bulk-generate one clean A4 timetable per class (Mon–Thu × slots, with subject/teacher/room per cell). All 12 classes in one PDF. Saves the admin from manually building these in Excel every semester.

### 4. ~~Drag-Conflict Nudge Tooltip~~ ✅ Done

### 5. Teacher Personal Schedule Link (Milestone 2)
A read-only URL (`/teacher/{token}`) showing a teacher's own weekly timetable from the published schedule. No login required, mobile-friendly, always reflects the latest published version. Teachers currently get a PDF by email — a live link means they always see the current state. This is Milestone 2 from the original spec.

---

## 🧪 Testing Backlog (2026-06-18)

Issues found during manual testing of the scheduler and editor.

**Completed in session 10:** T2 ✅, T3 ✅, T4 ✅, T5 ✅, T7 ✅, T8 ✅, T9 ✅

**Remaining:** T1 (needs design decision), T6 (complex UI)

### T1 — Free day for grade 12
Grade 12 doesn't have enough lessons to fill a full week, so one day should be declared a "Free Day" — no lessons placed in it at all. Needs design: is this a restriction (`CLASS_FREE_DAY`), a config flag on the grade, or something else? If a restriction, the AS must respect it and the evaluator must enforce it. Discuss before implementing.

### T2 — Day labels hard to read in manual schedule editor
The day-column headers in the schedule grid are not prominent enough and are hard to scan. Make them more visually distinct (bolder, larger, or with a background separator).

### T3 — Roomless lessons (no room required)
Some lessons (e.g. PE outside, online sessions) don't need a physical room. Add a boolean `noRoomRequired` flag on `Lesson`. The room allocator in the AS and the manual editor should skip room assignment for these entries entirely. Related migration: `20260604120000_add_subject_no_room_required` may partially address this at the subject level — check what exists before adding a new migration.

### T4 — Small rooms: room capacity tiers
Two-tier room sizing: mark a `Room` as `isSmall: boolean`. Mark a `Lesson` as `allowSmallRoom: boolean`. Room allocator must only assign small rooms to lessons explicitly flagged as compatible. Large classes must not be placed in small rooms.

### T5 — Mark entire day as unavailable in teacher availability modal
In the teacher availability modal, clicking a single button for a day should toggle ALL slots in that day unavailable (or toggle them back). One click per day instead of slot-by-slot.

### T6 — Click empty slot to place a lesson (with eligibility surfacing)
Clicking an empty cell in the manual schedule grid should open a modal listing all lessons eligible for that slot. Ineligible lessons should also appear (grayed out) with the violation they would create, and an override option to place them anyway.

### T7 — Room assignment modal: show availability
When manually assigning a room to a placed lesson, only show rooms that are free at that time slot. Occupied rooms should still appear but with a warning (which lesson is using them), allowing the user to override if needed.

### T8 — Overridden violations excluded from violation counts
Throughout the app (sidebar badge, violations panel header, landing page stats), violation counts include overridden violations. Overridden violations should not count toward any displayed total — only active (non-overridden) violations should be counted.

### T9 — Art rooms reserved for art lessons only
The room allocator (both AS and manual assignment) must never place a non-art lesson in a room designated as an art room. This is likely a new evaluator restriction type and allocator filter. Needs a way to mark a room as "art room" (could be a `roomType` enum or a boolean `isArtRoom` on `Room`).

---

## 💡 Ideas to Workshop

### Teacher Workload Dashboard
A dedicated view showing each teacher's assigned hours this week vs. their target hours (a new `targetHours` field on the Teacher model), color-coded: green = on target, amber = ±1, red = over/under. Currently admins count this manually. Needs UX design before committing to an approach.

---

## Minor Cleanup

- [ ] Remove dead `gradeMap` comment in `CompactViewPage`
- [ ] Keyboard accessibility audit — tab order through grid, focus management in modals
