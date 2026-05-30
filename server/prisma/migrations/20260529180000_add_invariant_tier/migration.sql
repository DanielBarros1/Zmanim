-- Add INVARIANT to the RestrictionTier enum.
-- INVARIANT is used exclusively by the evaluator for hard physical constraints
-- (teacher double-booked, class double-booked, etc.).  No Restriction row will
-- ever have this tier — it exists so Prisma type-checks cleanly.
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL < 12.
-- Prisma wraps migrations in transactions, so we use a BEGIN/COMMIT-free form.
-- On PostgreSQL 12+ this is safe and atomic.

ALTER TYPE "RestrictionTier" ADD VALUE IF NOT EXISTS 'INVARIANT' BEFORE 'NON_NEGOTIABLE';
