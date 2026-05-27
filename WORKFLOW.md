# Zmanim — Development Workflow

This document defines how we build this project, phase by phase.
It is a living reference — update it if the process evolves.

---

## Phase 1 — Product Spec
Brainstorm and lock down what we're building: features, scope, user types, edge cases.
Decisions and guiding principles are committed into `docs/product-spec.md`.

## Phase 2 — Design Spec
Generate HTML mockups (looks & feel only, no functionality) and iterate until we're happy.
Finalized design decisions, color palette, and aesthetic principles are committed into `docs/design-spec.md`.

## Phase 3 — Implementation Plan
Break the product spec into actionable feature chunks with detailed implementation instructions.
Stack is decided here. We iterate until there is as little ambiguity as possible.
The plan is committed into `docs/implementation-plan.md`.

## Phase 4 — Implementation
Build the app. During this phase:
- Decisions, learnings, and corrections are documented in `docs/dev-log.md` so future sessions can pick up without losing context.
- Code is documented extensively — no business or design decisions left undocumented.
- Commits are frequent and descriptive.

## Phase 5 — Debugging & Improvements
Iterative cycles of testing, fixing, and refining until we reach a satisfying state.

## Phase 6 — Deployment
Ship it.

---

## General Principles
- No ambiguity should survive past Phase 3.
- If Claude is corrected during Phase 4, the correction goes into `dev-log.md` — not just applied silently.
- Design and product decisions made in Phases 1–2 are the source of truth during implementation.
