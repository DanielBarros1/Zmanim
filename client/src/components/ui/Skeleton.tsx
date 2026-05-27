/**
 * Skeleton — shimmer loading placeholder.
 *
 * Used instead of full-page spinners for content-heavy pages (homepage,
 * definitions lists) so the user gets a sense of the layout before data
 * arrives.
 *
 * Skeleton       — generic block; size/shape via className / style props
 * SkeletonCard   — mimics a schedule card on the HomePage
 * SkeletonRow    — mimics a data row (teacher, room, lesson, etc.)
 */

import type { CSSProperties } from 'react'

// ── Base shimmer block ─────────────────────────────────────────

interface SkeletonProps {
  className?: string
  style?: CSSProperties
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`rounded animate-pulse ${className}`}
      style={{ background: 'var(--surface-2)', ...style }}
    />
  )
}

// ── Schedule card skeleton ─────────────────────────────────────

/**
 * Matches the visual weight of a real ScheduleCard on the HomePage.
 */
export function SkeletonCard() {
  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header row: star + name + badge */}
      <div className="flex items-start gap-3">
        <Skeleton className="w-5 h-5 rounded-full mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      {/* Progress bar */}
      <Skeleton className="h-1.5 w-full rounded-full" />

      {/* Action buttons */}
      <div className="flex gap-2">
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
    </div>
  )
}

// ── Data row skeleton (for definition pages) ───────────────────

/**
 * Matches the visual weight of a single entity row (teacher, room, etc.).
 */
export function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-lg border"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <Skeleton className="flex-1 h-4" style={{ maxWidth: 200 }} />
      <div className="flex gap-2 ml-auto">
        <Skeleton className="h-6 w-12 rounded-md" />
        <Skeleton className="h-6 w-14 rounded-md" />
      </div>
    </div>
  )
}
