# Zmanim — Dev Log

> Running record of decisions, learnings, and corrections made during implementation.
> Update this file whenever: a non-obvious choice is made, a spec ambiguity is resolved in code, or a correction is received.

---

## 2026-05-27 — Phase 1: Foundation

### Room assignment decision (pre-implementation)
**Decision:** Rooms are auto-assigned on placement using this priority: (1) specialized room if subject requires it, (2) free LARGE room for SHARED lessons, (3) any free room otherwise. Admin can override via a room chip on the lesson card. Placement is never blocked by room unavailability — it's flagged as a warning instead.
**Why:** Keeps the editing flow fast. Admin shouldn't have to think about rooms on every placement, but should be able to fix them easily.

### Monorepo structure
Using npm workspaces with three packages: `client`, `server`, `shared`. The `shared` package contains TypeScript types used by both sides — no runtime code, types only. This avoids duplicating entity shapes and keeping restriction types in sync.

### Why Vite over Next.js
This is a tool, not a website. No SEO, no SSR needed. Vite gives faster dev iteration and simpler mental model. The backend is a separate Express server, which is better for the auto-scheduler (worker threads, long-running jobs).

### Session storage
Using connect-pg-simple to store sessions in Postgres (the `sessions` table). Avoids Redis dependency. Fine for 50 users max.

### Tailwind theme
CSS custom properties (from design-spec) are defined in `client/src/index.css` and referenced in `tailwind.config.js` as theme extensions. This keeps the design token system as the single source of truth — Tailwind classes map to our tokens, not raw colors.

---

## 2026-05-27 — Phases 2–5: Client UI

### CSS custom properties + Tailwind v4 approach
We use CSS custom properties (`var(--...)`) for all semantic color values (dark/light mode), and use Tailwind v4 utilities for layout, spacing, and typography. Color overrides use Tailwind's arbitrary value syntax (`bg-[var(--surface)]`) or inline styles. This avoids needing a `@theme` block in CSS and keeps the design token system readable in both the CSS and the JSX.

### `/api/classes` endpoint added
The original grades route returned grades with nested classes. Added a separate `/api/classes` flat endpoint so the client can fetch all classes without needing to flatten the grade tree. Both endpoints coexist on the server.

### Grades API returns flat list
`GET /api/grades` now returns just `{ id, number }[]` (without embedded classes). The client fetches classes separately via `/api/classes`. This keeps the data model clean and matches the shared TypeScript types.

### Client-side evaluator (lib/evaluator.ts)
Only checks hard invariants (D1/D2/D3) for instant drag preview feedback. All 20 soft restriction violations are only surfaced from the server's `EvaluationResult` returned after each placement. This avoids duplicating all restriction logic on the client.

### Drag-and-drop architecture
Using `@dnd-kit/core` with a 5px activation distance (avoids accidental drags). Droppable IDs encode the target: `cell-{day}-{slot}-{classId}`. Draggable IDs differentiate pool items (`pool-{lessonId}`) from placed entries (`entry-{entryId}`). The `DragOverlay` renders a pill showing the subject name — avoids rendering a full card during drag for performance.

### ViolationConfirmModal — reactive overrides
The override flow is "reactive" — only shown when a drag-and-drop results in violations. The admin can add a note explaining the override. Hard invariant overrides use a red danger button to make the weight of the decision clear. Non-blocking by design (product-spec §5).

### Lesson Pool panel
The right-side lesson pool shows all lessons with `hoursPerWeek - placedCount > 0`. Items are sorted by most remaining first. The pool is hidden in Review Mode (no edits allowed). Pool items are draggable just like placed entries.

### LessonCard remove button
Uses `opacity-0 hover:opacity-100` to hide unless hovered. This keeps the grid clean when not actively editing. Seeded lessons have no remove button. Review mode disables all remove buttons.

### Schedule views (Phase 5)
Three read-only views: Teacher View (5-day grid for one teacher), Grade View (5-day grid for one grade with A/B columns), Compact View (color-coded matrix for printing). All three use the published schedule by default, falling back to the most recent schedule.

### Auth flow
`useCurrentUser()` hits `/auth/me` (not `/api/me` — the auth routes live under `/auth`). Returns null (not 401) from the hook so React components can handle the unauthenticated state gracefully without error boundaries.

---

## 2026-05-28 — Phase 7: Review Mode Polish

### Bug fixes found during Phase 7 implementation

**`GET /api/schedules/:id/entries` was missing.**
The `entriesRouter` had POST / PATCH / DELETE for entries but no GET. The client's `useEntries()` hook called this endpoint and got 404. Fixed by adding `GET /:id/entries` to `server/src/routes/entries.ts` (reads directly from `prisma.scheduleEntry.findMany`).

**`useUpdateSchedule` used PUT, server uses PATCH.**
The server's update route is `schedulesRouter.patch(...)`. The client called `apiClient.put(...)`. Express doesn't route PUT to a PATCH handler — silent 404. Fixed client to use `apiClient.patch(...)`.

**`useMoveEntry` also used PUT, server uses PATCH.**
Same issue — entries move route is `entriesRouter.patch('/:id/entries/:entryId', ...)`. Fixed client to use `apiClient.patch(...)`.

### Evaluation state — moved from local useState to React Query cache

Originally, `ScheduleEditorPage` held evaluation in a `useState` that was updated in a `handlePlacementResult` callback after every mutation. This meant that:
- On first load, evaluation was null (no violations shown) until a placement was made
- After `useRemoveEntry`, evaluation was never updated (stale)

**New approach:** Added `GET /api/schedules/:id/evaluate` server endpoint. Client has `useEvaluation(scheduleId)` hook. All three mutation hooks (`usePlaceEntry`, `useMoveEntry`, `useRemoveEntry`) now write the server's returned `EvaluationResult` directly into the query cache via `qc.setQueryData(evaluationKey, result.evaluation)`. The page component uses `useEvaluation()` as its single reactive source of truth — no `useState` needed.

### Review Mode auto-open violations panel
When `isReviewMode` becomes true (after AS redirect or manual toggle), a `useEffect` in `ScheduleEditorPage` immediately sets `showViolationPanel = true`. This gives the user an immediate view of what the AS produced.

### Violation → cell scroll flow
When the user clicks "Highlight N affected lessons" in `ViolationPanel`, three things happen via the Zustand store and React effects:
1. `setHighlightedEntryIds(ids)` — LessonCards glow (already done in Phase 4)
2. `useEffect` in `ScheduleEditorPage` watches `highlightedEntryIds` and switches `activeDay` to the day of the first affected entry
3. `useEffect` in `ScheduleGrid` watches `highlightedEntryIds` and uses `document.querySelector('[data-entry-id="..."]')` + `scrollIntoView` with a 200 ms delay (gives React time to re-render the new day before querying the DOM)

### Publish flow in editor (Review Mode)
The Publish button is now surfaced prominently in the editor's topbar when in Review Mode (in addition to the existing card-level button on HomePage). On click: `usePublishSchedule.mutateAsync(scheduleId)` → success → brief green banner → `setReviewMode(false)` → `navigate('/')` after 2 s. The 2 s gives the user time to read the banner.

---

## 2026-05-28 — Phase 8: Polish

### Error boundaries
Added `ErrorBoundary` class component (wraps React's `componentDidCatch`). Placed around the entire protected route tree in `App.tsx`. Each page crash shows a friendly error UI with "Try again" (resets boundary state) and "Go home" (navigates to `/`). Logs to console for dev; could forward to Sentry in prod.

### Loading skeletons (HomePage)
Replaced the `<Spinner>` full-page loader on `HomePage` with 3 `<SkeletonCard>` placeholders. These mimic the visual footprint of real schedule cards so the page doesn't jump in layout when data arrives. Definitions pages keep their simple row-level spinners for now — the data is small enough that skeleton feel is overkill there.

### Print styles (CompactView)
Added `@media print` rules to `index.css`:
- `aside` (sidebar) is hidden
- `[data-no-print]` elements are hidden — Topbar has `data-no-print` attribute
- `#root` and `main` have height/overflow reset so the full table can flow across pages
- `print-color-adjust: exact` forces subject color blocks to render even with "Print backgrounds" off

### Dark mode transitions
Added CSS transitions for `background-color`, `border-color`, and `color` on all structural HTML elements (`div`, `span`, `p`, `td`, etc.) in `index.css`. Interactive elements (`button`, `input`) were deliberately excluded to keep hover feedback snappy. `transform` was excluded to keep DnD performance unaffected.

### RTL audit result
All Hebrew text fields consistently use the `.hebrew` CSS class (sets `direction: rtl; text-align: right`). Key sites:
- LessonCard: subject name + teacher name — ✅
- TeachersPage: teacher name in list + form input with `isHebrew` — ✅
- LessonsPage: form inputs for lesson names use `isHebrew` — verified
- CompactView: subject name in legend has `.hebrew` — ✅
- Sidebar: "זמנים" Hebrew label in logo — renders inline, no RTL needed (two chars)

---

## 2026-05-31 — Session 9: User Management

### Two-tier user access model
Added a second tier below root: "invited users" stored in a new `AllowedEmail` DB table. Root users (env-based, `ALLOWED_EMAILS`) can add/revoke invited users via the `/users` admin page. Invited users can log in but cannot manage other users. The `/users` page is root-only.

**Why not roles on the User model?** Root is an ops/owner concern that should survive any DB reset — keeping it in `ALLOWED_EMAILS` env means even if the entire DB is wiped, the owner can still log in. The invited-user table is for everyone else.

**`isRoot` on AuthUser:** Derived from env at request time (not stored in DB) and exposed via `/auth/me`. Used by the frontend to show/hide the Admin sidebar section and guard the Users page.

**Migration history activated:** This session added the first real Prisma migration (`20260531120000_add_allowed_email`). The initial schema was baselined as `20260101000000_initial_schema` using `prisma migrate resolve --applied`. Future schema changes must follow `migrate dev` → commit migration file → `migrate deploy` on prod.

---

## 2026-06-17 — Session 10: AS Algorithm Overhaul + Observability

### In-process log buffer + /api/logs endpoint
Added `server/src/services/logBuffer.ts`: a 1000-entry circular buffer that intercepts `process.stdout.write` and `process.stderr.write` at startup. This captures logs from the AS job (which runs in the main thread via `setImmediate`) as well as all other server logs.

`GET /api/logs` is protected by either a valid root session or a `LOG_API_KEY` bearer token (set in `.env`). This allows programmatic log access via `curl` without a browser session — used for autonomous debugging between Claude sessions.

**Why intercept process.write instead of console.log?** The AS uses `console.log` / `console.warn` which route through `process.stdout.write`/`process.stderr.write`. Intercepting at the stream level captures everything including third-party library logs.

### Gate S: seed validation (warning-only)
Before each AS run, if a seed schedule is provided, all seed entries are evaluated for D-invariant (hard) violations. The result is **logged as a warning only — it never blocks the run**.

**Why:** Admins deliberately place some lessons in conflicting positions (e.g. teacher double-booked for a one-off event). The seed represents user-verified reality. Blocking on seed violations would make the AS unusable for partially-problematic seeds.

### isSeededOnlyViolation: treating seeded violations as user-accepted
Helper function that returns `true` when ALL `affectedEntryIds` in a violation belong to seeded entries. Used in three places:
1. **Gate 2:** Seeded-only violations don't block the run even if they're INVARIANT-tier
2. **compositeHard in local search:** Seeded-only INVARIANT violations excluded from the hard-violation count so they don't inflate SA temperature
3. **Candidate ranking:** `invariantCount` excludes seeded-only violations for fair comparison between restarts

### Dynamic MRV in the backtracker (replaced static pre-sort)
The original backtracker pre-sorted instances by constraint density at startup and used that static order for all levels. This caused 44/60 restarts to time out because the "most constrained" order is stale after each placement.

**New approach:** At every recursive level, scan all unplaced instances, count valid slots for each against CURRENT occupancy, and pick the one with the fewest options (dynamic MRV). If any instance has 0 valid slots, return false immediately (early pruning). This is classic constraint propagation — it reduced timeouts from 44/60 to 0/30.

**Cost:** O(n²) per level instead of O(1) lookup, but n is small (≤200 instances) and the prune gain more than compensates.

### Gate 2: blocking types restricted
Gate 2 validates the AS output before saving. Originally it blocked on ALL INVARIANT violations. Reduced to only physically-impossible conflicts:
- `TEACHER_DOUBLE_BOOKED` (D1)
- `CLASS_DOUBLE_BOOKED` (D2)
- `LESSON_GRADE_SYNC` (D3/D4)

`CLASS_SUBJECT_TWICE_PER_DAY` (D7) was removed. D7 is a quality preference that the AS cannot always satisfy — treating it as a hard blocker caused valid 30-restart runs to be discarded after 5+ minutes of work.

### Top-1 candidate instead of top-3
The AS previously tracked the 3 best candidates across all restarts, keeping 3 full entry arrays in memory simultaneously. On the 1 GB Oracle VM this was enough to trigger OOM on long runs (30 restarts × large entry arrays × 3 copies).

Changed to track only 1 best candidate. The ranking function (`isBetterCandidate`) is unchanged — it still compares by invariantCount → classConflicts → gradeSyncConflicts → hardCount → score. The client-facing API response format is unchanged (still has `candidates[]` array, just always length 1 now).

### Telegram notification on deploy
`.github/workflows/deploy.yml` now sends a Telegram message via `appleboy/telegram-action@v0.1.1` after every successful SSH deploy. Secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` stored in GitHub repo secrets. Uses an existing Telegram bot (not a new one).

### Postgres OOM during long AS runs (ongoing)
During 30-restart runs, Postgres gets OOM-killed by the kernel around restart 14–16, dropping all `connect-pg-simple` session store connections. Symptoms: `Connection terminated unexpectedly` errors in server logs every ~10s, "lost connection" for client polling.

**Root cause:** 1 GB RAM with no swap. The AS holds a large in-memory state for ~5 minutes; Postgres has no room to page out.

**Mitigation in code:** Reduced peak memory by switching to top-1 candidate.

**Full fix (manual server action):** Add 1 GB swap on the Oracle VM:
```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
