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
