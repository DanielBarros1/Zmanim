/**
 * ViolationPanel — slide-in panel showing all constraint violations.
 *
 * Violation tiers (top to bottom):
 *   INVARIANT       — hard physical impossibilities; no override, but suggest-fix shown
 *   NON_NEGOTIABLE  — user-configured; can be overridden + suggest-fix shown
 *   IMPORTANT / PREFERRED / FLEXIBLE — soft; can be overridden + suggest-fix shown
 *   Overridden      — acknowledged violations
 *
 * Suggest-fix flow (per ViolationItem):
 *   1. Admin clicks "💡 Suggest fix"
 *   2. POST /api/schedules/:id/suggest-fix with violation context
 *   3. Up to 3 FixSuggestion cards appear below the violation
 *   4. Each card shows: label, from→to, improvement delta
 *   5. "Apply" button calls moveEntry — on success, violation disappears
 */

import { useState } from 'react'
import type { EvaluationResult, Violation } from '@zmanim/shared'
import { RestrictionTier, TIER_LABEL } from '@zmanim/shared'
import { useScheduleStore } from '../../store/scheduleStore'
import { useAddOverride, useRemoveOverride, useSuggestFix, useMoveEntry } from '../../api/schedules'
import type { FixSuggestion } from '../../api/schedules'
import { Badge } from '../ui/Badge'

// ── Constants ──────────────────────────────────────────────────────

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

const TIER_HEADING: Record<RestrictionTier, string> = {
  [RestrictionTier.INVARIANT]:      'Hard Invariants',
  [RestrictionTier.NON_NEGOTIABLE]: 'Non-negotiable',
  [RestrictionTier.IMPORTANT]:      'Important',
  [RestrictionTier.PREFERRED]:      'Preferred',
  [RestrictionTier.FLEXIBLE]:       'Flexible',
}

/**
 * Violation types for which the suggest-fix engine has a solver.
 * If the type is not in this set, the button is not shown.
 */
const FIXABLE_TYPES = new Set([
  'TEACHER_DOUBLE_BOOKED',
  'CLASS_DOUBLE_BOOKED',
  'MATH_GROUPS_NOT_SIMULTANEOUS',
  'ENGLISH_GROUPS_NOT_SIMULTANEOUS',
  'CLASS_SUBJECT_TWICE_PER_DAY',
  'TEACHER_UNAVAILABLE_DAY',
  'TEACHER_UNAVAILABLE_SLOT',
  'TEACHER_UNAVAILABLE_DAY_SLOT',
  'TEACHER_MAX_LESSONS_PER_DAY',
  'CLASS_NO_WINDOW',
])

const DAY_LABEL: Record<string, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
}

// ── Suggestion card ────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  scheduleId,
  onApplied,
}: {
  suggestion: FixSuggestion
  scheduleId: string
  onApplied: () => void
}) {
  const moveEntry = useMoveEntry(scheduleId)
  const [applied, setApplied] = useState(false)

  const handleApply = async () => {
    try {
      await moveEntry.mutateAsync({
        entryId: suggestion.entryId,
        data: { day: suggestion.toDay as any, slot: suggestion.toSlot, overrides: [] },
      })
      setApplied(true)
      onApplied()
    } catch {
      // Silently fail — the violation panel will update via evaluation cache
    }
  }

  if (applied) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px]"
        style={{ background: 'var(--ok-bg)', color: 'var(--ok-text)' }}
      >
        <span>✓</span>
        <span>Applied — check violations panel</span>
      </div>
    )
  }

  return (
    <div
      className="rounded-md border text-[11px] overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex-1 min-w-0">
          {/* From → To */}
          <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-1)' }}>
            <span className="hebrew truncate max-w-[80px]">{suggestion.entryLabel}</span>
            <span style={{ color: 'var(--text-3)' }}>
              {DAY_LABEL[suggestion.fromDay] ?? suggestion.fromDay} S{suggestion.fromSlot}
            </span>
            <span style={{ color: 'var(--text-3)' }}>→</span>
            <span style={{ color: 'var(--accent)' }}>
              {DAY_LABEL[suggestion.toDay] ?? suggestion.toDay} S{suggestion.toSlot}
            </span>
          </div>
          {/* Score improvement */}
          <div className="mt-0.5" style={{ color: 'var(--ok-text)' }}>
            −{suggestion.improvement.toLocaleString()} pts
          </div>
        </div>

        <button
          onClick={handleApply}
          disabled={moveEntry.isPending}
          className="ml-2 px-2.5 py-1 rounded text-[11px] font-semibold text-white disabled:opacity-50 shrink-0"
          style={{ background: 'var(--accent)' }}
        >
          {moveEntry.isPending ? '…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

// ── Violation item ─────────────────────────────────────────────────

function ViolationItem({ violation, scheduleId }: { violation: Violation; scheduleId: string }) {
  const { setHighlightedEntryIds } = useScheduleStore()
  const isOverridden = violation.isOverridden
  const isInvariant  = violation.tier === RestrictionTier.INVARIANT

  const canOverride = !isInvariant && violation.restrictionId !== null && violation.affectedEntryIds.length > 0
  const canSuggest  = FIXABLE_TYPES.has(String(violation.restrictionType)) && violation.affectedEntryIds.length > 0

  const addOverride    = useAddOverride(scheduleId)
  const removeOverride = useRemoveOverride(scheduleId)
  const suggestFix     = useSuggestFix(scheduleId)

  const [showNote,      setShowNote]      = useState(false)
  const [note,          setNote]          = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions,   setSuggestions]   = useState<FixSuggestion[]>([])
  const [suggestError,  setSuggestError]  = useState<string | null>(null)

  // ── Override handlers ────────────────────────────────────────────

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

  // ── Suggest-fix handler ──────────────────────────────────────────

  const handleSuggest = async () => {
    if (showSuggestions) {
      setShowSuggestions(false)
      return
    }
    setSuggestError(null)
    try {
      const result = await suggestFix.mutateAsync({
        violationType:    String(violation.restrictionType),
        affectedEntryIds: violation.affectedEntryIds,
        restrictionId:    violation.restrictionId,
      })
      setSuggestions(result)
      setShowSuggestions(true)
    } catch {
      setSuggestError('Could not compute suggestions — try again.')
      setShowSuggestions(true)
    }
  }

  const isBusy = addOverride.isPending || removeOverride.isPending

  return (
    <div
      className="p-3 rounded-lg border text-[12px]"
      style={{
        background:  'var(--surface)',
        borderColor: isInvariant ? 'color-mix(in srgb, var(--warn-bg) 60%, var(--border))' : 'var(--border)',
        opacity:     isOverridden ? 0.6 : 1,
      }}
    >
      {/* Badges row */}
      <div className="flex items-start gap-2 mb-1 flex-wrap">
        {isInvariant ? (
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

      {/* Highlight + Suggest row */}
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        {violation.affectedEntryIds.length > 0 && (
          <button
            onClick={() => setHighlightedEntryIds(violation.affectedEntryIds)}
            className="text-[11px] underline"
            style={{ color: 'var(--accent)' }}
          >
            Highlight {violation.affectedEntryIds.length} lesson{violation.affectedEntryIds.length > 1 ? 's' : ''} →
          </button>
        )}
        {canSuggest && !isOverridden && (
          <button
            onClick={handleSuggest}
            disabled={suggestFix.isPending}
            className="text-[11px] flex items-center gap-1 font-medium disabled:opacity-50"
            style={{ color: showSuggestions ? 'var(--text-2)' : 'var(--accent)' }}
          >
            {suggestFix.isPending ? (
              <span className="opacity-60">Thinking…</span>
            ) : showSuggestions ? (
              '▲ Hide fixes'
            ) : (
              '💡 Suggest fix'
            )}
          </button>
        )}
      </div>

      {/* Suggestions panel */}
      {showSuggestions && (
        <div className="mt-2 space-y-1.5">
          {suggestError ? (
            <p className="text-[11px]" style={{ color: 'var(--warn-text)' }}>{suggestError}</p>
          ) : suggestions.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              No clear fix found — try manually rearranging affected lessons.
            </p>
          ) : (
            suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                suggestion={s}
                scheduleId={scheduleId}
                onApplied={() => setShowSuggestions(false)}
              />
            ))
          )}
        </div>
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

// ── Panel ──────────────────────────────────────────────────────────

interface ViolationPanelProps {
  evaluation: EvaluationResult
  scheduleId: string
  onClose: () => void
}

export function ViolationPanel({ evaluation, scheduleId, onClose }: ViolationPanelProps) {
  const active    = evaluation.violations.filter(v => !v.isOverridden)
  const overridden = evaluation.violations.filter(v => v.isOverridden)
  const invariantCount = evaluation.counts.invariant

  return (
    <div
      className="flex flex-col border-l h-full"
      style={{ width: 300, minWidth: 300, background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-1)]">Violations</p>
          <p className="text-[11px] text-[var(--text-3)]">
            {invariantCount > 0 && (
              <span className="font-semibold" style={{ color: 'var(--warn-text)' }}>{invariantCount} invariant · </span>
            )}
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
                    Physically impossible — use 💡 Suggest fix or drag lessons manually.
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
