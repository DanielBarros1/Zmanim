/**
 * ViolationPanel — slide-in panel showing all constraint violations.
 *
 * Violation tiers (top to bottom in the panel):
 *   INVARIANT       — hard physical impossibilities; no override button.
 *   NON_NEGOTIABLE  — user-configured; can be overridden.
 *   IMPORTANT / PREFERRED / FLEXIBLE — soft constraints; can be overridden.
 *   Overridden      — explicitly acknowledged violations.
 */

import { useState } from 'react'
import type { EvaluationResult, Violation } from '@zmanim/shared'
import { RestrictionTier, TIER_LABEL } from '@zmanim/shared'
import { useScheduleStore } from '../../store/scheduleStore'
import { useAddOverride, useRemoveOverride } from '../../api/schedules'
import { Badge } from '../ui/Badge'

const TIER_ORDER: RestrictionTier[] = [
  RestrictionTier.INVARIANT,
  RestrictionTier.NON_NEGOTIABLE,
  RestrictionTier.IMPORTANT,
  RestrictionTier.PREFERRED,
  RestrictionTier.FLEXIBLE,
]

const TIER_BADGE_VARIANT: Record<RestrictionTier, 'warn' | 'accent' | 'ok' | 'neutral'> = {
  [RestrictionTier.INVARIANT]:       'warn',
  [RestrictionTier.NON_NEGOTIABLE]:  'warn',
  [RestrictionTier.IMPORTANT]:       'accent',
  [RestrictionTier.PREFERRED]:       'ok',
  [RestrictionTier.FLEXIBLE]:        'neutral',
}

/** Section heading shown above each tier group */
const TIER_HEADING: Record<RestrictionTier, string> = {
  [RestrictionTier.INVARIANT]:      'Hard Invariants',
  [RestrictionTier.NON_NEGOTIABLE]: 'Non-negotiable',
  [RestrictionTier.IMPORTANT]:      'Important',
  [RestrictionTier.PREFERRED]:      'Preferred',
  [RestrictionTier.FLEXIBLE]:       'Flexible',
}

interface ViolationPanelProps {
  evaluation: EvaluationResult
  scheduleId: string
  onClose: () => void
}

function ViolationItem({ violation, scheduleId }: { violation: Violation; scheduleId: string }) {
  const { setHighlightedEntryIds } = useScheduleStore()
  const isOverridden = violation.isOverridden
  const isInvariant  = violation.tier === RestrictionTier.INVARIANT

  // Hard invariants cannot be overridden — they're physical impossibilities with
  // no DB restriction record (restrictionId === null) and no Override enum value.
  const canOverride = !isInvariant && violation.restrictionId !== null && violation.affectedEntryIds.length > 0

  const addOverride    = useAddOverride(scheduleId)
  const removeOverride = useRemoveOverride(scheduleId)
  const [showNote, setShowNote] = useState(false)
  const [note, setNote]         = useState('')

  const handleAdd = async () => {
    await addOverride.mutateAsync({
      entryId:         violation.affectedEntryIds[0],
      restrictionType: String(violation.restrictionType),
      restrictionId:   violation.restrictionId,
      note:            note.trim() || undefined,
    })
    setShowNote(false)
    setNote('')
  }

  const handleRemove = async () => {
    await Promise.all(
      violation.affectedEntryIds.map(id =>
        removeOverride.mutateAsync({
          entryId:         id,
          restrictionType: String(violation.restrictionType),
          restrictionId:   violation.restrictionId,
        }),
      ),
    )
  }

  const isBusy = addOverride.isPending || removeOverride.isPending

  return (
    <div
      className="p-3 rounded-lg border text-[12px]"
      style={{
        background:   'var(--surface)',
        borderColor:  isInvariant ? 'color-mix(in srgb, var(--warn-bg) 60%, var(--border))' : 'var(--border)',
        opacity:      isOverridden ? 0.6 : 1,
      }}
    >
      {/* Badges */}
      <div className="flex items-start gap-2 mb-1 flex-wrap">
        {isInvariant ? (
          /* Invariant badge: distinct from NON_NEGOTIABLE — uses a solid fill + uppercase */
          <span
            className="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)', letterSpacing: '0.08em' }}
          >
            Invariant
          </span>
        ) : (
          <Badge variant={TIER_BADGE_VARIANT[violation.tier as RestrictionTier]}>
            {TIER_LABEL[violation.tier as RestrictionTier] ?? violation.tier}
          </Badge>
        )}
        {isOverridden && <Badge variant="neutral">Overridden</Badge>}
      </div>

      {/* Message */}
      <p className="text-[var(--text-1)] leading-snug">{violation.message}</p>

      {/* Highlight link */}
      {violation.affectedEntryIds.length > 0 && (
        <button
          onClick={() => setHighlightedEntryIds(violation.affectedEntryIds)}
          className="mt-1.5 text-[11px] underline"
          style={{ color: 'var(--accent)' }}
        >
          Highlight {violation.affectedEntryIds.length} affected lesson{violation.affectedEntryIds.length > 1 ? 's' : ''} →
        </button>
      )}

      {/* Override controls */}
      {canOverride && !isOverridden && (
        <div className="mt-2">
          {showNote ? (
            <div className="flex flex-col gap-1.5">
              <input
                className="w-full text-[11px] px-2 py-1 rounded border focus:outline-none"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
                placeholder="Override note (optional)"
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') { setShowNote(false); setNote('') }
                }}
                autoFocus
                disabled={isBusy}
              />
              <div className="flex gap-1">
                <button
                  onClick={handleAdd}
                  disabled={isBusy}
                  className="flex-1 text-[11px] font-medium px-2 py-1 rounded text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {addOverride.isPending ? '…' : 'Confirm Override'}
                </button>
                <button
                  onClick={() => { setShowNote(false); setNote('') }}
                  disabled={isBusy}
                  className="text-[11px] px-2 py-1 rounded disabled:opacity-50"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNote(true)}
              className="text-[11px] underline opacity-60 hover:opacity-100 transition-opacity"
              style={{ color: 'var(--text-2)' }}
            >
              Override violation →
            </button>
          )}
        </div>
      )}

      {canOverride && isOverridden && (
        <button
          onClick={handleRemove}
          disabled={isBusy}
          className="mt-1.5 text-[11px] underline opacity-60 hover:opacity-100 transition-opacity disabled:opacity-50"
          style={{ color: 'var(--text-2)' }}
        >
          {removeOverride.isPending ? '…' : 'Remove override'}
        </button>
      )}
    </div>
  )
}

export function ViolationPanel({ evaluation, scheduleId, onClose }: ViolationPanelProps) {
  const active    = evaluation.violations.filter(v => !v.isOverridden)
  const overridden = evaluation.violations.filter(v => v.isOverridden)
  const invariantCount = evaluation.counts.invariant

  return (
    <div
      className="flex flex-col border-l h-full"
      style={{ width: 280, minWidth: 280, background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-1)]">Violations</p>
          <p className="text-[11px] text-[var(--text-3)]">
            {invariantCount > 0 && <span className="font-semibold" style={{ color: 'var(--warn-text)' }}>{invariantCount} invariant · </span>}
            {active.length - invariantCount} active · {overridden.length} overridden
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-2)]" aria-label="Close panel">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {active.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl">✅</p>
            <p className="text-[13px] font-medium text-[var(--ok-text)] mt-2">No active violations</p>
          </div>
        ) : (
          TIER_ORDER.map(tier => {
            const tierViolations = (evaluation.byTier[tier as keyof typeof evaluation.byTier] ?? [])
              .filter(v => !v.isOverridden)
            if (tierViolations.length === 0) return null

            const isInvariantSection = tier === RestrictionTier.INVARIANT

            return (
              <div key={tier}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-1">
                  {TIER_HEADING[tier]} ({tierViolations.length})
                </p>
                {isInvariantSection && (
                  <p className="text-[10px] text-[var(--text-3)] mb-2 leading-snug">
                    Physically impossible — fix the schedule to resolve.
                  </p>
                )}
                <div className="space-y-2">
                  {tierViolations.map((v, i) => (
                    <ViolationItem key={i} violation={v} scheduleId={scheduleId} />
                  ))}
                </div>
              </div>
            )
          })
        )}

        {/* Overridden */}
        {overridden.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-2">
              Overridden ({overridden.length})
            </p>
            <div className="space-y-2">
              {overridden.map((v, i) => (
                <ViolationItem key={i} violation={v} scheduleId={scheduleId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
