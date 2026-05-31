# Zmanim — TODO & Feature Backlog

> Last updated: 2026-05-31
> This file is the source of truth for all pending work. Update it at the end of every session.

---

## ✅ Recently Completed

- **Delete published schedule** — server guard removed; client shows stronger warning + error handling.
- **Auto-scheduler all-placed guarantee** — 3-layer defence: count-based seed exclusion, per-restart check, Gate 3 finalization check. Job errors with user-friendly message if any lessons can't be placed.
- **Production deployment** — Docker image (`node:20-slim` + `debian-openssl-3.0.x` Prisma target), Express serves static files in production, trust proxy for Caddy. Domain: `https://zmanim.duckdns.org`. Cert auto-provisioned by Caddy via Let's Encrypt. See `docs/deployment.md` for full runbook including Docker gotchas.
- **Quick-Fix Suggestions** — 💡 button on each violation. Server-side engine, top-3 ranked by score improvement, 10 violation types.
- **Drag-Conflict Nudge Tooltip** — zero re-renders, direct DOM manipulation in pointermove handler.
- **Undo / Redo** — Ctrl+Z/Ctrl+Y, max 50 items, group placements undo as one batch.
- **Teacher Availability Batch Editor** — 🗓 Availability button, visual day×slot grid, tiered cells.
- **Google OAuth** — credentials configured, profile picture shown in sidebar.

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

- [ ] **Google OAuth credentials** — fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAIN=ankori.edu` in `/opt/zmanim/server/.env` on the server. Add `https://zmanim.duckdns.org` as authorized origin and `https://zmanim.duckdns.org/auth/google/callback` as redirect URI in Google Cloud Console. Then `sudo docker compose -f docker-compose.prod.yml restart zmanim-server`.
- [ ] **Prisma migration history** — all schema changes used `db push` (dev shortcut). Before any future schema change in production: run `prisma migrate dev` locally first, commit the migration files, then `prisma migrate deploy` on the server (not `db push`).

---

## Minor Cleanup

- [ ] Remove dead `gradeMap` comment in `CompactViewPage`
- [ ] Keyboard accessibility audit — tab order through grid, focus management in modals
