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
