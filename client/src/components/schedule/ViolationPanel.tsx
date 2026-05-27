/**
 * ViolationPanel — slide-in panel showing all constraint violations.
 *
 * Used in both the editor (optional overlay) and Review Mode (expanded by default).
 *
 * Layout:
 *   - Grouped by tier: Non-negotiable → Important → Preferred → Flexible
 *   - Each violation shows:
 *     - Type badge
 *     - Message
 *     - Affected entries (clicking scrolls grid to that cell + highlights it)
 *     - Overridden state (greyed out if overridden)
 *
 * Clicking "×" closes the panel.
 */

import type { EvaluationResult, Violation } from '@zmanim/shared'
import { RestrictionTier, TIER_LABEL } from '@zmanim/shared'
import { useScheduleStore } from '../../store/scheduleStore'
import { Badge } from '../ui/Badge'

const TIER_ORDER: RestrictionTier[] = [
  RestrictionTier.NON_NEGOTIABLE,
  RestrictionTier.IMPORTANT,
  RestrictionTier.PREFERRED,
  RestrictionTier.FLEXIBLE,
]

const TIER_BADGE_VARIANT: Record<
  RestrictionTier,
  'warn' | 'accent' | 'ok' | 'neutral'
> = {
  [RestrictionTier.NON_NEGOTIABLE]: 'warn',
  [RestrictionTier.IMPORTANT]: 'accent',
  [RestrictionTier.PREFERRED]: 'ok',
  [RestrictionTier.FLEXIBLE]: 'neutral',
}

interface ViolationPanelProps {
  evaluation: EvaluationResult
  onClose: () => void
}

function ViolationItem({ violation }: { violation: Violation }) {
  const { setHighlightedEntryIds } = useScheduleStore()
  const isOverridden = violation.isOverridden

  return (
    <div
      className="p-3 rounded-lg border text-[12px]"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        opacity: isOverridden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start gap-2 mb-1">
        <Badge variant={TIER_BADGE_VARIANT[violation.tier as RestrictionTier]}>
          {violation.tier.replace('_', ' ')}
        </Badge>
        {isOverridden && <Badge variant="neutral">Overridden</Badge>}
      </div>
      <p className="text-[var(--text-1)] leading-snug">{violation.message}</p>
      {violation.affectedEntryIds.length > 0 && (
        <button
          onClick={() => setHighlightedEntryIds(violation.affectedEntryIds)}
          className="mt-1.5 text-[11px] underline"
          style={{ color: 'var(--accent)' }}
        >
          Highlight {violation.affectedEntryIds.length} affected lesson{violation.affectedEntryIds.length > 1 ? 's' : ''} →
        </button>
      )}
    </div>
  )
}

export function ViolationPanel({ evaluation, onClose }: ViolationPanelProps) {
  const activeViolations = evaluation.violations.filter(v => !v.isOverridden)
  const overridden = evaluation.violations.filter(v => v.isOverridden)

  return (
    <div
      className="flex flex-col border-l h-full"
      style={{
        width: 280,
        minWidth: 280,
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-1)]">
            Violations
          </p>
          <p className="text-[11px] text-[var(--text-3)]">
            {activeViolations.length} active · {overridden.length} overridden
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-2)]"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeViolations.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl">✅</p>
            <p className="text-[13px] font-medium text-[var(--ok-text)] mt-2">
              No active violations
            </p>
          </div>
        ) : (
          TIER_ORDER.map(tier => {
            const byTierKey = tier as keyof typeof evaluation.byTier
            const tierViolations = (evaluation.byTier[byTierKey] ?? []).filter(
              v => !v.isOverridden,
            )
            if (tierViolations.length === 0) return null

            return (
              <div key={tier}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-2">
                  {TIER_LABEL[tier]} ({tierViolations.length})
                </p>
                <div className="space-y-2">
                  {tierViolations.map((v, i) => (
                    <ViolationItem key={i} violation={v} />
                  ))}
                </div>
              </div>
            )
          })
        )}

        {/* Overridden section */}
        {overridden.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-2">
              Overridden ({overridden.length})
            </p>
            <div className="space-y-2">
              {overridden.map((v, i) => (
                <ViolationItem key={i} violation={v} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
