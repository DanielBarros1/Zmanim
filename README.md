# Zmanim — School Timetable Builder

A scheduling system for Ankori High School, Israel. Replaces a manual Excel-based
timetable process with a web app that can auto-schedule lessons, enforce constraints,
and let staff drag-and-drop placements to refine the result.

**Live:** https://zmanim.duckdns.org

---

## What it does

- **Define** the school's structure: subjects, rooms, teachers, lessons, restrictions
- **Auto-schedule** — generate a full week timetable that satisfies all configured constraints
- **Edit** — drag lessons between time slots, with real-time violation highlighting
- **Publish** — mark a schedule as the active one; it appears on the Home page
- **View** — teacher view, grade view, compact overview (all 12 classes × all slots)

---

## Stack

| | |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4 |
| Client state | Zustand + TanStack Query v5 |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma v5 |
| Auth | Google OAuth 2.0 (passport) |
| Infrastructure | Docker, Caddy (auto-TLS), Oracle Cloud Free Tier |

---

## Quick start (local dev)

```bash
# Install deps
npm install

# Build shared types (required before anything compiles)
npm run build --workspace=shared

# Start local postgres
docker compose up postgres -d

# Set up the database
cd server && npx prisma db push && npx tsx src/seed.ts && cd ..

# Create server/.env — see server/.env.example
# Leave GOOGLE_CLIENT_ID empty to use the dev-login bypass

# Run everything
npm run dev   # server on :3001, client on :5173
```

Open http://localhost:5173. Click **Dev Login** (bypasses Google OAuth when
`GOOGLE_CLIENT_ID` is empty).

---

## Project layout

```
client/   React SPA (Vite)
server/   Express API + Prisma
shared/   TypeScript types shared between client and server
docs/     Product spec, design spec, implementation plan, dev log, deployment runbook
```

For a full architecture walkthrough, see **`CLAUDE.md`** — written for AI assistants
and developers who need to pick up the codebase cold.

---

## Deployment

Hosted on Oracle Cloud Free Tier (1 GB RAM VM) at `zmanim.duckdns.org`.
GitHub Actions deploys on every push to `main`.

Full runbook: `docs/deployment.md`

---

## Development notes

- **UI language:** English. **Content** (lesson/teacher/room names): Hebrew — RTL is a first-class concern.
- **School week:** Sunday–Thursday (Israeli).
- **Grades:** 7–12, two sections (A/B) each — 12 classes total, seeded at startup, not user-created.
- **Auth:** Google OAuth. New users are auto-created as ADMIN on first login. No public registration.
- See `TODO.md` for the feature backlog.
