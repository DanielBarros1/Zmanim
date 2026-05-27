/**
 * ViolationsBanner — amber warning bar shown when violations exist.
 *
 * Appears between day tabs and the schedule grid.
 * Clicking "View all violations →" opens the violations panel.
 * Only renders when there are active (non-overridden) violations.
 */

import type { EvaluationResult } from '@zmanim/shared'

interface ViolationsBannerProps {
  evaluation: EvaluationResult
  onViewAll: () => void
}

export function ViolationsBanner({ evaluation, onViewAll }: ViolationsBannerProps) {
  const active = evaluation.counts.total - evaluation.counts.overridden
  if (active === 0) return null

  const nonNeg = evaluation.counts.nonNegotiable
  const important = evaluation.counts.important

  return (
    <div
      className="flex items-center gap-4 px-6 py-2.5 text-[12px] font-medium flex-shrink-0"
      style={{
        background: 'var(--warn-bg)',
        borderBottom: '1px solid var(--warn-border)',
        color: 'var(--warn-text)',
      }}
    >
      <span>⚠</span>
      <span>
        {active} active violation{active !== 1 ? 's' : ''}
        {nonNeg > 0 && ` — ${nonNeg} non-negotiable`}
        {important > 0 && ` — ${important} important`}
      </span>
      <button
        onClick={onViewAll}
        className="ml-auto underline hover:no-underline"
        style={{ color: 'var(--warn-text)' }}
      >
        View all violations →
      </button>
    </div>
  )
}
