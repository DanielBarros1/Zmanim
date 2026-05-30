# Zmanim — TODO & Feature Backlog

> Last updated: 2026-05-30
> This file is the source of truth for all pending work. Update it at the end of every session.

---

## ✅ Recently Completed

- **Undo / Redo** — Ctrl+Z/Ctrl+Y history stack in the schedule editor (place, move, remove). Group placements (MATH/ENGLISH) undo as one batch. Max 50 items. Buttons in topbar too.
- **Teacher Availability Batch Editor** — 🗓 Availability button on each teacher card in Restrictions → Teachers. Visual day×slot grid, tiered cells (NON_NEGOTIABLE / IMPORTANT / FLEXIBLE). Saves as TEACHER_UNAVAILABLE_DAY_SLOT restrictions.
- **Google OAuth** — credentials configured, profile picture shown in sidebar.

---

## Feature Backlog

### 1. XLSX Exporter
Export the published schedule to Excel. Format TBD — needs a decision on layout (one sheet per grade? per teacher? one big matrix?) before implementation.

### 2. ~~Teacher Availability Batch Editor~~ ✅ Done

### 3. Quick-Fix Suggestions on Violations
A "Suggest fix" button next to each violation in the violations panel. Computes a valid move that eliminates the violation without creating new non-negotiables — turns the panel from a read-only report into an actionable assistant. **Large feature:** requires a semantic solver for each of the 20 violation types.

### 4. Per-Class Timetable Print / Export
Bulk-generate one clean A4 timetable per class (Mon–Thu × slots, with subject/teacher/room per cell). All 12 classes in one PDF. Saves the admin from manually building these in Excel every semester.

### 5. Drag-Conflict Nudge Tooltip
When dragging a lesson and hovering over a blocked/red cell, show a small tooltip explaining *why* it's blocked — e.g. "Teacher already has History here" or "Creates a window violation for 8A". Removes the guesswork of "why is this cell red?"

### 6. Teacher Personal Schedule Link (Milestone 2)
A read-only URL (`/teacher/{token}`) showing a teacher's own weekly timetable from the published schedule. No login required, mobile-friendly, always reflects the latest published version. Teachers currently get a PDF by email — a live link means they always see the current state. This is Milestone 2 from the original spec.

---

## 💡 Ideas to Workshop

### Teacher Workload Dashboard
A dedicated view showing each teacher's assigned hours this week vs. their target hours (a new `targetHours` field on the Teacher model), color-coded: green = on target, amber = ±1, red = over/under. Currently admins count this manually. Needs UX design before committing to an approach.

---

## Production Blockers

- [ ] **Google OAuth credentials** — set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_EMAIL_DOMAIN=ankori.edu` in `server/.env`. The `dev-login` bypass must be disabled in production.
- [ ] **Prisma migration history** — all schema changes so far used `db push` (dev shortcut). Before deploying: run `prisma migrate dev` locally to create proper migration files, then `prisma migrate deploy` on the server.

---

## Minor Cleanup

- [ ] Remove dead `gradeMap` comment in `CompactViewPage`
- [ ] Keyboard accessibility audit — tab order through grid, focus management in modals (was in Phase 8 checklist, not fully done)
