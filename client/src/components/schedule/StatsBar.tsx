/**
 * StatsBar — four stat cards below the topbar.
 *
 * Cards:
 *   1. Lessons Placed — count + progress bar
 *   2. Violations — count in warning color if >0
 *   3. Hard Conflicts — non-negotiable count
 *   4. Schedule state badge
 *
 * Data comes from the EvaluationResult (fetched after each placement)
 * and the entry/lesson counts.
 */

import type { EvaluationResult } from '@zmanim/shared'
import type { ScheduleSummary } from '@zmanim/shared'
import { ScheduleState } from '@zmanim/shared'
import { Badge } from '../ui/Badge'

interface StatsBarProps {
  schedule: ScheduleSummary
  evaluation: EvaluationResult | null
}

function StatCard({
  label,
  value,
  sub,
  warn,
  ok,
}: {
  label: string
  value: string | number
  sub?: string
  warn?: boolean
  ok?: boolean
}) {
  return (
    <div
      className="flex flex-col gap-0.5 px-4 py-3 rounded-lg border"
      style={{
        background: warn ? 'var(--warn-bg)' : ok ? 'var(--ok-bg)' : 'var(--surface)',
        borderColor: warn ? 'var(--warn-border)' : ok ? 'var(--ok-border)' : 'var(--border)',
      }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: warn ? 'var(--warn-text)' : ok ? 'var(--ok-text)' : 'var(--text-3)' }}
      >
        {label}
      </p>
      <p
        className="text-[22px] font-bold leading-none"
        style={{ color: warn ? 'var(--warn-text)' : ok ? 'var(--ok-text)' : 'var(--text-1)' }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

export function StatsBar({ schedule, evaluation }: StatsBarProps) {
  const placed = schedule.totalPlaced
  const total = schedule.totalRequired
  const pct = total === 0 ? 0 : Math.round((placed / total) * 100)

  const violations = evaluation?.counts.total ?? 0
  const nonNeg = evaluation?.counts.nonNegotiable ?? 0
  const overridden = evaluation?.counts.overridden ?? 0

  return (
    <div
      className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Placed */}
      <div
        className="flex flex-col gap-1 px-4 py-2 rounded-lg border flex-1 min-w-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">
          Lessons Placed
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[20px] font-bold text-[var(--text-1)]">
            {placed}
            <span className="text-[13px] font-normal text-[var(--text-3)]">/{total}</span>
          </span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: pct === 100 ? 'var(--ok-text)' : 'var(--accent)',
              }}
            />
          </div>
          <span className="text-[11px] text-[var(--text-3)] tabular-nums">{pct}%</span>
        </div>
      </div>

      {/* Violations */}
      <StatCard
        label="Violations"
        value={violations - overridden}
        sub={overridden > 0 ? `${overridden} overridden` : undefined}
        warn={violations - overridden > 0}
        ok={violations === 0}
      />

      {/* Hard conflicts */}
      <StatCard
        label="Hard Conflicts"
        value={nonNeg}
        sub="Non-negotiable"
        warn={nonNeg > 0}
        ok={nonNeg === 0}
      />

      {/* State */}
      <div className="flex flex-col items-center gap-1 px-4 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">
          State
        </p>
        <Badge variant={schedule.state === ScheduleState.PUBLISHED ? 'published' : 'draft'}>
          {schedule.state}
        </Badge>
      </div>
    </div>
  )
}
