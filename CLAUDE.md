# Zmanim — Claude Code Context

> Read this before writing any code. It is the single source of truth for
> architecture decisions, patterns, and hard-won lessons. The other docs
> (`docs/product-spec.md`, `docs/design-spec.md`, `docs/dev-log.md`) contain
> more detail; this file contains everything you need to start working.

---

## What is Zmanim?

**Zmanim** (Hebrew: זמנים — "times") is a school timetable builder for
**Ankori High School** in Israel. It replaces a manual Excel-based process.

- **Primary users (Milestone 1):** scheduling staff (admins building the timetable)
- **Future (Milestone 2):** teacher-facing read-only view (`/teacher/{token}`)
- **School structure:** grades 7–12, two sections per grade (A/B), 12 classes total
- **Work week:** Sunday–Thursday (Israeli school week)
- **Language rule:** UI is in English. All content (teacher/subject/room names) is
  Hebrew — RTL rendering for content fields is a first-class concern. Use
  `dir="rtl"` HTML attribute on inputs, not CSS classes.

---

## Tech Stack

| Layer | Choice | Version / Notes |
|---|---|---|
| Frontend | React | 19 + Vite + TypeScript |
| Styling | Tailwind | v4 (JIT, no config file needed) |
| Client state | Zustand | persisted stores in `localStorage` |
| Server state | TanStack Query | v5 (all API calls go through hooks) |
| Drag & Drop | @dnd-kit/core | schedule editor grid |
| Backend | Express | Node.js + TypeScript |
| ORM | Prisma | v5, PostgreSQL |
| Auth | Google OAuth 2.0 | passport-google-oauth20, sessions in Postgres |
| Monorepo | npm workspaces | `client/`, `server/`, `shared/` |
| Container | Docker | single multi-stage Dockerfile |
| Reverse proxy | Caddy | auto-TLS via Let's Encrypt |

---

## Local Development

### Prerequisites
- Docker Desktop (for local Postgres)
- Node.js 20+
- npm 10+
- Git Bash (Windows) or any POSIX shell

### First-time setup
```bash
# 1. Copy env file
cp server/.env.example server/.env
# Fill in DATABASE_URL, SESSION_SECRET, CLIENT_URL=http://localhost:5173
# Leave GOOGLE_CLIENT_ID empty for dev-login bypass

# 2. Install deps (all workspaces)
npm install

# 3. Build shared types (must be done once before anything compiles)
npm run build --workspace=shared

# 4. Start local Postgres
docker compose up postgres -d

# 5. Push schema to DB and seed it
cd server && npx prisma db push && npx tsx src/seed.ts && cd ..

# 6. Run full stack
npm run dev   # starts both server:3001 and client:5173
```

### After any reboot (Windows)
Run `C:\Users\User\Zmanim\scripts\start-dev.ps1` — it handles Docker socket
cleanup, starts Postgres, and launches both dev servers.

### Dev login bypass
When `GOOGLE_CLIENT_ID` is empty, `GET /auth/dev-login` creates or reuses a
`dev@zmanim.local` ADMIN user and sets the session. This endpoint is only
active in non-production mode. Use it instead of wiring up OAuth locally.

---

## Project Structure

```
Zmanim/
├── client/                  React SPA (Vite + TypeScript)
│   └── src/
│       ├── api/             TanStack Query hooks (one file per resource)
│       ├── components/
│       │   ├── layout/      AppShell, Sidebar, AuthGuard, ErrorBoundary
│       │   ├── schedule/    Schedule editor components (grid, cards, pool)
│       │   └── ui/          Reusable primitives (Button, Modal, Badge, etc.)
│       ├── pages/
│       │   ├── LandingPage.tsx       Home: stats + embedded schedule table
│       │   ├── HomePage.tsx          Schedule list + management (/schedules)
│       │   ├── ScheduleEditorPage.tsx  Full DnD timetable editor
│       │   ├── ImportPage.tsx        XLSX import
│       │   ├── definitions/          CRUD pages for all school entities
│       │   └── views/                Read-only views (teacher/grade/compact)
│       └── store/           Zustand stores (uiStore: dark mode, sidebar, etc.)
│
├── server/                  Express API
│   ├── prisma/
│   │   ├── schema.prisma    Source of truth for the DB schema
│   │   └── seed.ts          Seeds grades (7-12), classes (A/B), school config
│   └── src/
│       ├── app.ts           Express entry point — all wiring (CORS, session, routes)
│       ├── middleware/
│       │   ├── passport.ts  Google OAuth strategy configuration
│       │   └── requireAuth/requireAdmin  Route guards
│       ├── routes/          One file per resource (CRUD + business logic)
│       └── services/
│           ├── evaluator.ts       Constraint evaluator (20 restriction types)
│           └── autoscheduler.ts   Worker-thread AS engine
│
├── shared/                  Types shared between client and server
│   └── src/
│       ├── enums.ts         All enums (Day, LessonType, etc.) — re-exported by Prisma
│       └── entities.ts      Plain TS interfaces that mirror Prisma models
│
├── docs/
│   ├── product-spec.md      What we're building and why
│   ├── design-spec.md       Visual design decisions, color palette
│   ├── implementation-plan.md  Original build plan
│   ├── dev-log.md           All architectural decisions and corrections
│   └── deployment.md        Full production runbook (server setup, Docker gotchas)
│
├── .claude/
│   ├── settings.json        Project hooks (pre-push check, dev server restart)
│   └── pre-push-check.sh    Pre-push TypeScript validation script
│
├── Dockerfile               Multi-stage production build
├── docker-compose.prod.yml  Production compose (joins finanse_default network)
├── docker-compose.yml       Local dev compose (exposes postgres:5432)
└── TODO.md                  Feature backlog and production blockers
```

---

## Architecture Decisions

### Monorepo with shared types
`shared/` contains enums and entity interfaces used by both client and server.
It must be built before either workspace: `npm run build --workspace=shared`.
Vite resolves `@zmanim/shared` via a path alias in `vite.config.ts`. TypeScript
resolves it via `tsconfig.json` path mappings.

### Single process in production
Express serves both the API (`/api/*`, `/auth/*`) and the built React SPA
(`client/dist/`). This avoids needing a separate static-file nginx/Caddy route.
The `if (process.env.NODE_ENV === 'production')` block in `app.ts` adds the
static middleware AFTER all API routes — order matters.

### Sessions in Postgres
Auth state is stored via `connect-pg-simple` in a `sessions` table (auto-created
on first run). Session cookies are `httpOnly`, `secure` in production,
`sameSite: strict`. `app.set('trust proxy', 1)` is required — without it,
Express thinks Caddy→server is HTTP and refuses `Secure` cookies.

### Google OAuth with dev bypass
`configurePassport()` in `server/src/middleware/passport.ts` only registers the
Google strategy when `GOOGLE_CLIENT_ID` is set (guards with `if (clientId && clientSecret)`).
When it's empty the app starts without crashing. The dev-login route
(`GET /auth/dev-login`) creates an ADMIN user and is only registered outside production.

### User access control — two tiers
1. **Root users** — email in `ALLOWED_EMAILS` env var (comma-separated). Always allowed
   in. Can invite/revoke other users via `/users` page. `isRoot: true` on `AuthUser`.
2. **Invited users** — email in `AllowedEmail` DB table. Added by root users via the app.
   Can log in but cannot manage other users. `isRoot: false`.

If `ALLOWED_EMAILS` is set but the login email is in neither tier, access is denied.
If `ALLOWED_EMAILS` is empty, any Google account can log in (no restriction).

**`requireRoot` middleware** is in `server/src/middleware/requireRoot.ts`.
**`isRootEmail(email)`** helper is exported from same file — used in `/auth/me` to populate `isRoot`.
Sidebar shows the "Admin" section (with `/users` link) only when `user.isRoot === true`.

### Evaluation cache
`useEvaluation(scheduleId)` hits `GET /api/schedules/:id/evaluate`. ALL
placement mutation hooks call `queryClient.invalidateQueries(['schedules', scheduleId, 'evaluate'])`
on success so violation counts stay live. Never compute evaluation results
locally — always read from this TanStack Query key.

### Review Mode
`uiStore.isReviewMode` is a Zustand flag (not a route) that auto-opens the
violations panel and shows the Publish button. Set it after running the
auto-scheduler or when opening a draft for review.

---

## Database Schema — Key Concepts

See `server/prisma/schema.prisma` for the full annotated schema.

### Grades and Classes
Grades (7–12) and their A/B classes are **seeded once and never user-created**.
There is no UI to add or delete them. `seed.ts` inserts all 12 classes.

### Lesson Types
The `LessonType` enum is the most complex part of the schema:

| Type | Description | classIds | teacherId | LessonTeacher rows |
|---|---|---|---|---|
| `REGULAR` | 1 class, 1 teacher | 1 class | set | none |
| `SHARED` | 2 classes together, 1 teacher | 2 classes | set | none |
| `PARALLEL` | 2 classes split, different teachers | 2 classes | null | 2 rows (one per class) |
| `MATH_GROUP` | Grade-level math groups (cross-class) | both grade classes | null | 2 rows |
| `ENGLISH_GROUP` | Grade-level English groups | both grade classes | null | 2 rows |
| `MULTI_TEACHER` | 2 classes, 1 room, multiple teachers | 2 classes | null | N rows |

`LessonTeacher` is the join table for PARALLEL and MULTI_TEACHER.
`PARALLEL`: 2 rows, each with a `classId`. `MULTI_TEACHER`: N rows, `classId` null.

### ScheduleEntry
One entry = one placed lesson in the timetable. Fields:
- `day` + `slot`: the time cell (Sunday–Thursday, slots 1–N)
- `roomId` / `roomId2`: PARALLEL lessons use two rooms simultaneously
- `isSeeded`: if true, the auto-scheduler will not move this entry
- `overrides`: user-acknowledged violations on this placement

### Restrictions
Restrictions are user-configured soft/hard rules. Each has:
- `type`: one of 20 `RestrictionType` values (e.g. `TEACHER_UNAVAILABLE_DAY`)
- `tier`: `NON_NEGOTIABLE | IMPORTANT | PREFERRED | FLEXIBLE`
- `scope`: optional teacherId / classId / gradeId / lessonId / subjectId
- `params`: JSON blob whose shape depends on the type

`INVARIANT` tier is never stored on Restriction rows — it is generated by the
evaluator for hard physical impossibilities (e.g. teacher in two places at once).

---

## Server Routes

All routes require auth except `/health`, `/auth/*`.
Mutation routes require `ADMIN` role (enforced by `requireAdmin` middleware).

| Prefix | File | Notes |
|---|---|---|
| `GET /health` | app.ts | Docker health check |
| `/auth/*` | routes/auth.ts | login, logout, /me, dev-login, Google OAuth flow |
| `/api/config` | routes/config.ts | GET + PATCH school config (one record) |
| `/api/subjects` | routes/subjects.ts | CRUD |
| `/api/rooms` | routes/rooms.ts | CRUD |
| `/api/teachers` | routes/teachers.ts | CRUD + backfill-subjects |
| `/api/grades` | routes/grades.ts | GET only (seeded, not user-created) |
| `/api/classes` | routes/grades.ts | GET only |
| `/api/lessons` | routes/lessons.ts | CRUD, discriminated by LessonType |
| `/api/restrictions` | routes/restrictions.ts | CRUD |
| `/api/schedules` | routes/schedules.ts | CRUD, publish, clone, summary |
| `/api/schedules/:id/entries` | routes/entries.ts | GET all, POST (place), PATCH (move), DELETE |
| `/api/schedules/:id/evaluate` | routes/schedules.ts | Run constraint evaluator |
| `/api/schedules/:id/suggest-fix` | routes/schedules.ts | Top-3 fix suggestions per violation |
| `/api/schedules/auto` | routes/autoscheduler.ts | POST (run AS), GET status, DELETE (cancel) |
| `/api/import` | routes/import.ts | POST XLSX, returns parsed lesson rows |
| `/api/users` | routes/users.ts | GET list, POST invite, DELETE revoke — root only |

---

## Frontend Patterns

### API hooks (TanStack Query)
Every server resource has a file in `client/src/api/` exporting hooks:
- `useFoo()` — `useQuery` for fetching
- `useCreateFoo()` / `useUpdateFoo()` / `useDeleteFoo()` — `useMutation` with
  `queryClient.invalidateQueries` in `onSuccess`

**Always use these hooks. Never call `fetch` directly in components.**

### Error handling in forms
Every `mutateAsync()` call must be wrapped in try/catch. Errors from the server
come back on `err?.response?.data?.error`. Display them above the submit buttons.

```tsx
const [error, setError] = useState<string>()
const handleSubmit = async (data: Input) => {
  setError(undefined)
  try {
    await mutation.mutateAsync(data)
    onClose()
  } catch (err: any) {
    setError(err?.response?.data?.error ?? 'Failed to save.')
  }
}
```

### State management
- **Zustand (`uiStore`):** persisted UI state — dark mode, sidebar collapsed, review mode.
  Read via `useUIStore()` hook.
- **TanStack Query:** all server data. Never duplicate server data in Zustand.

### Sidebar
The sidebar collapses to 52px (icon-only). State: `uiStore.sidebarCollapsed`,
persisted to `localStorage` key `zmanim-sidebar-collapsed`. Toggle button (‹‹) at
the bottom. `AppShell` uses flex so the content area adjusts automatically.

### The schedule editor
`ScheduleEditorPage` is the most complex component. Key points:
- Drag uses `@dnd-kit/core`. `activeDragRef` (useRef) sidesteps React batching
  stale-closure issues in `handleDragEnd` — always read `activeDragRef.current`,
  not the state variable.
- Violations panel auto-opens in Review Mode. Evaluator results come from
  `useEvaluation(scheduleId)` — never local state.
- Undo/redo: Ctrl+Z/Ctrl+Y, max 50 items, group placements undo as one batch.

---

## The Constraint Evaluator

`server/src/services/evaluator.ts` is the authoritative constraint checker.
It takes a list of `ScheduleEntry` objects and returns violations grouped by tier.

**20 restriction types** in 3 categories:
- **A — Teacher availability:** unavailable day/slot, max days, max lessons/day,
  max consecutive, max window, no single-lesson day
- **B — Class quality:** no window (gap), minimize windows, no subject twice/day,
  arts balance, no subject at edge on multiple days
- **C — Room:** large room required for SHARED lessons

**5 hard invariants** (checked first, always NON_NEGOTIABLE):
- Teacher in two places at once
- Class in two places at once
- Room used twice simultaneously
- Lesson exceeds hoursPerWeek placement
- Specialized room not used for its subject

The evaluator is called on demand via `GET /api/schedules/:id/evaluate`.
Results are cached in TanStack Query and invalidated after every placement.

---

## The Auto-Scheduler

`server/src/services/autoscheduler.ts` runs in a worker thread.

**Three-layer placement guarantee** (every lesson MUST be placed):
1. **Count-based seed exclusion:** `seededCountPerLesson` Map tracks how many
   instances of each lesson are already seeded. The `toPlace` array only includes
   instances that need a new placement.
2. **Per-restart all-placed check:** before committing a candidate, verifies that
   all `toPlace` instances are covered in the current result. If not, discards and
   tries the next restart.
3. **Gate 3 finalization:** after building enriched results, checks every lesson's
   `hoursPerWeek` against actual placements. Candidates that don't place all lessons
   are rejected.

If after all restarts no valid candidate places every lesson, the job fails with a
user-friendly error explaining the slot budget.

---

## Production Deployment

**Server:** Oracle Cloud Free Tier — AMD VM.Standard.E2.1.Micro (1 OCPU, 1 GB RAM),
Ubuntu 22.04, IP `151.145.91.170`. Shared with the **finanse** personal finance app.

**Live URL:** `https://zmanim.duckdns.org` (DuckDNS free subdomain)

**Network:** Both apps share `finanse_default` Docker bridge network and the
`finanse-caddy-1` Caddy container. Zmanim's `docker-compose.prod.yml` declares
the network as `external: true`.

**Database:** `finanse-postgres-1` container, database `zmanim`, user `zmanim`.
Postgres superuser is `finanse` (not `postgres`) — use `-U finanse` in psql.

**CI/CD:** GitHub Actions (`.github/workflows/deploy.yml`) — SSHes in on every
push to `main`, runs `git pull && sudo docker compose -f docker-compose.prod.yml up -d --build`.
Secrets: `SERVER_HOST=151.145.91.170`, `DEPLOY_SSH_KEY` (private key for ubuntu@server).

### Day-to-day server commands
```bash
# Logs
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml logs -f

# Restart after .env change (does NOT rebuild image)
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml restart zmanim-server

# Rebuild + redeploy (code change)
cd /opt/zmanim && git pull
sudo docker compose -f docker-compose.prod.yml up -d --build

# Force clean rebuild (after Prisma schema changes)
sudo docker compose -f docker-compose.prod.yml build --no-cache
sudo docker compose -f docker-compose.prod.yml up -d

# Run migrations (after schema change)
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx prisma db push
```

### Schema changes in production
Migration history is now active (established in session 9).
The `_prisma_migrations` table exists in the DB; the initial schema is registered
as baseline and `20260531120000_add_allowed_email` was the first real migration.

**Workflow for future schema changes:**
1. Update `schema.prisma`
2. Create migration SQL in `server/prisma/migrations/YYYYMMDDHHMMSS_name/migration.sql`
3. Run `npx prisma migrate deploy` locally to apply + register it
4. Commit the migration file
5. On production: `docker compose exec zmanim-server npx prisma migrate deploy`

Note: `prisma migrate dev` can't run in Claude Code's non-interactive terminal.
Create migration SQL manually and use `migrate deploy` directly (which is non-interactive).

---

## Pre-Push Validation Hook

`.claude/settings.json` has a `PreToolUse` hook that fires on every `git push`
command. It runs `.claude/pre-push-check.sh`, which mirrors the exact Docker
build steps:

1. `npm run build --workspace=shared`
2. `cd client && npx tsc -b` ← strict project-references, catches `noUnusedLocals`
3. `cd server && npx tsc --noEmit`

If any step fails, the push is blocked and the failing step is reported.

**Always use `tsc -b` (not `tsc --noEmit`) for client** — they use different
tsconfig settings. `tsc --noEmit` misses errors that `tsc -b` (project references
mode) catches. The Docker build uses `tsc -b && vite build`.

---

## Critical Gotchas

### Docker + Prisma
- Base image must be `node:20-slim` (Debian), NOT Alpine. Prisma 5 OpenSSL
  detection fails silently on musl/Alpine, loads the wrong binary, crashes.
- `binaryTargets = ["native", "debian-openssl-3.0.x"]` in schema.prisma.
- `prisma generate` must run BEFORE `tsc` in the Dockerfile — otherwise
  `@prisma/client` has no exported types and tsc fails with TS7006 cascade errors.
- After schema changes: `docker compose build --no-cache` (layer caching hides fixes).

### Bash on the server
- `!` in passwords and `!@hostname` in DATABASE_URL trigger bash history expansion.
- Always use single-quoted heredocs (`<<'EOF'`) for any shell command that
  contains special characters. `<<EOF` (unquoted) will expand them.

### TypeScript strictness
- The Docker build runs `tsc -b` (project references) which enforces
  `noUnusedLocals: true`. The local `tsc --noEmit` does not catch this.
- Any unused variable (even destructuring `_gradeIdx`) will fail the deployment.
- `Record<SomeEnum, V>` must have ALL enum keys — missing keys are TypeScript errors.

### React patterns
- `(bool && value) ?? fallback` evaluates to `false` when `bool` is false —
  `??` only catches `null`/`undefined`. Use `bool ? value : fallback`.
- DnD stale closures: use `useRef` alongside `useState` for values read inside
  drag handlers. Handlers read `ref.current`, not state.
- Number inputs: `Number(e.target.value)` on an empty input returns `NaN`.
  Use `Number(e.target.value) || fallback`.
- RTL inputs: use `dir="rtl"` HTML attribute directly. `direction-rtl` is not a
  Tailwind v4 class.

### HTTP verbs
All server update routes use `PATCH`, not `PUT`. Client hooks must use
`apiClient.patch()`. This has bitten us before — always verify server verb.

---

## Current Status (2026-05-31)

### Done
- All 12 build phases complete
- Production live at `https://zmanim.duckdns.org`
- Google OAuth configured and working
- GitHub Actions auto-deploy on push to `main`

### Pending / TODO
See `TODO.md` for the full backlog. Key items:

- **XLSX Exporter** — export published schedule to Excel
- **Per-Class Timetable Print** — bulk-generate A4 timetables for all 12 classes
- **Teacher Personal Schedule Link (Milestone 2)** — read-only `/teacher/{token}` URL
- **Teacher Workload Dashboard** — hours assigned vs target hours
- **Prisma migration discipline** — currently `db push`; switch to `migrate dev/deploy`
  before the next schema change in production

### Minor cleanup
- Remove dead `gradeMap` comment in `CompactViewPage`
- Keyboard accessibility audit
