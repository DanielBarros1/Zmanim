/**
 * TeacherAvailabilityModal — visual day×slot grid for bulk-setting a teacher's
 * TEACHER_UNAVAILABLE_DAY_SLOT restrictions.
 *
 * UX:
 *   - Tier selector at top (NON_NEGOTIABLE / IMPORTANT / FLEXIBLE / Clear)
 *   - Click a cell → applies the selected tier; click same tier again → clears cell
 *   - Clear mode removes any mark from clicked cells
 *
 * On save: caller deletes all existing TEACHER_UNAVAILABLE_DAY_SLOT restrictions
 * for this teacher and recreates from the returned cells array.
 */

import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { RestrictionTier, Day } from '@zmanim/shared'
import type { Teacher, Restriction, SchoolConfig } from '@zmanim/shared'

const DAY_LABEL: Record<Day, string> = {
  [Day.SUNDAY]: 'Sun',
  [Day.MONDAY]: 'Mon',
  [Day.TUESDAY]: 'Tue',
  [Day.WEDNESDAY]: 'Wed',
  [Day.THURSDAY]: 'Thu',
}

const TIER_CONFIG: Record<RestrictionTier, { bg: string; text: string; border: string; abbr: string; label: string; description?: string }> = {
  [RestrictionTier.INVARIANT]:      { bg: '#7c3aed', text: '#fff', border: '#7c3aed', abbr: 'INV', label: '⛔ Invariant',       description: 'Physically impossible — scheduler will never place a lesson here' },
  [RestrictionTier.NON_NEGOTIABLE]: { bg: '#ef4444', text: '#fff', border: '#ef4444', abbr: 'NN',  label: '🔴 Non-Negotiable', description: 'Very strong preference — scheduler avoids but may violate if necessary' },
  [RestrictionTier.IMPORTANT]:      { bg: '#f59e0b', text: '#fff', border: '#f59e0b', abbr: 'IMP', label: '🟡 Important',       description: 'Strong preference' },
  [RestrictionTier.PREFERRED]:      { bg: '#22c55e', text: '#fff', border: '#22c55e', abbr: 'PRF', label: '🟢 Preferred',       description: 'Soft preference' },
  [RestrictionTier.FLEXIBLE]:       { bg: '#94a3b8', text: '#fff', border: '#94a3b8', abbr: 'FLX', label: '⚪ Flexible',        description: 'Nice to have' },
}

// Tiers a user can paint in the availability grid.
// INVARIANT is included here (but not in the general restriction form) because
// teacher unavailability can represent a physical impossibility — the scheduler
// will never place a lesson at an INVARIANT-blocked slot, regardless of how tight
// the schedule is.
const PAINT_TIERS = [
  RestrictionTier.INVARIANT,
  RestrictionTier.NON_NEGOTIABLE,
  RestrictionTier.IMPORTANT,
  RestrictionTier.FLEXIBLE,
] as const

// null = clear mode
type PaintMode = RestrictionTier | null

export interface AvailabilityCell {
  day: Day
  slot: number
  tier: RestrictionTier
}

interface Props {
  open: boolean
  onClose: () => void
  onSave: (cells: AvailabilityCell[]) => void
  saving: boolean
  teacher: Teacher
  /** All existing TEACHER_UNAVAILABLE_DAY_SLOT restrictions for this teacher */
  restrictions: Restriction[]
  config: SchoolConfig
}

export function TeacherAvailabilityModal({ open, onClose, onSave, saving, teacher, restrictions, config }: Props) {
  const workDays = (config.workDays ?? []) as Day[]
  const slots = Array.from({ length: config.slotsPerDay }, (_, i) => i + 1)

  // Which tier the brush is set to (null = eraser)
  const [paintMode, setPaintMode] = useState<PaintMode>(RestrictionTier.NON_NEGOTIABLE)

  // Grid: key = `${day}:${slot}`, value = tier or undefined (available)
  const [grid, setGrid] = useState<Record<string, RestrictionTier>>({})

  // Initialise grid from existing restrictions whenever modal opens
  useEffect(() => {
    if (!open) return
    const initial: Record<string, RestrictionTier> = {}
    for (const r of restrictions) {
      const p = r.params as { day?: Day; slot?: number }
      if (p.day && p.slot != null) {
        initial[`${p.day}:${p.slot}`] = r.tier
      }
    }
    setGrid(initial)
    setPaintMode(RestrictionTier.NON_NEGOTIABLE)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellClick = (day: Day, slot: number) => {
    const key = `${day}:${slot}`
    setGrid(prev => {
      const next = { ...prev }
      if (paintMode === null) {
        // Erase
        delete next[key]
      } else if (next[key] === paintMode) {
        // Same tier → toggle off
        delete next[key]
      } else {
        next[key] = paintMode
      }
      return next
    })
  }

  const clearAll = () => setGrid({})

  const handleSave = () => {
    const cells: AvailabilityCell[] = Object.entries(grid).map(([key, tier]) => {
      const [day, slotStr] = key.split(':')
      return { day: day as Day, slot: Number(slotStr), tier }
    })
    onSave(cells)
  }

  const markedCount = Object.keys(grid).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Availability — ${teacher.name}`}
      width="max-w-2xl"
    >
      <div className="space-y-5">

        {/* ── Tier brush selector ── */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Select a tier, then click cells to paint
          </p>
          <div className="flex gap-2 flex-wrap">
            {PAINT_TIERS.map(tier => {
              const c = TIER_CONFIG[tier]
              const active = paintMode === tier
              return (
                <button
                  key={tier}
                  onClick={() => setPaintMode(active ? null : tier)}
                  className="px-3 py-1.5 rounded-md text-[12px] font-medium border-2 transition-all"
                  style={{
                    background:  active ? c.bg      : 'var(--surface)',
                    color:       active ? c.text    : 'var(--text-2)',
                    borderColor: active ? c.border  : 'var(--border)',
                  }}
                  title={c.description}
                >
                  {c.label}
                </button>
              )
            })}
            {/* Eraser */}
            <button
              onClick={() => setPaintMode(null)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium border-2 transition-all"
              style={{
                background:  paintMode === null ? 'var(--surface-2)' : 'var(--surface)',
                color:       'var(--text-2)',
                borderColor: paintMode === null ? 'var(--text-2)'    : 'var(--border)',
              }}
            >
              ✕ Eraser
            </button>
          </div>
          {/* Contextual hint for the active tier */}
          {paintMode !== null && TIER_CONFIG[paintMode].description && (
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
              {TIER_CONFIG[paintMode].description}
            </p>
          )}
        </div>

        {/* ── Grid ── */}
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="border-collapse w-full">
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th
                  className="text-[11px] font-semibold text-right pr-3 py-2 w-14"
                  style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
                >
                  Slot
                </th>
                {workDays.map(day => (
                  <th
                    key={day}
                    className="text-[11px] font-semibold text-center py-2"
                    style={{
                      color: 'var(--text-2)',
                      borderBottom: '1px solid var(--border)',
                      minWidth: 80,
                    }}
                  >
                    {DAY_LABEL[day]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, si) => (
                <tr
                  key={slot}
                  style={{ borderBottom: si < slots.length - 1 ? '1px solid var(--border)' : 'none' }}
                >
                  <td
                    className="text-[12px] font-medium text-right pr-3 py-2"
                    style={{ color: 'var(--text-3)' }}
                  >
                    S{slot}
                  </td>
                  {workDays.map(day => {
                    const key = `${day}:${slot}`
                    const cellTier = grid[key]
                    const c = cellTier ? TIER_CONFIG[cellTier] : null
                    return (
                      <td key={day} className="p-1.5">
                        <button
                          onClick={() => handleCellClick(day, slot)}
                          className="w-full h-10 rounded-md text-[11px] font-bold border-2 transition-all hover:opacity-75 active:scale-95 select-none"
                          style={{
                            background:  c ? c.bg              : 'var(--surface-2)',
                            color:       c ? c.text            : 'var(--text-3)',
                            borderColor: c ? c.border          : 'var(--border)',
                            cursor:      'pointer',
                          }}
                          title={
                            cellTier
                              ? `${TIER_CONFIG[cellTier].label} — click to ${paintMode === cellTier ? 'clear' : 'change'}`
                              : 'Available — click to mark'
                          }
                        >
                          {cellTier ? TIER_CONFIG[cellTier].abbr : ''}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Legend ── */}
        <div className="flex gap-4 flex-wrap">
          {PAINT_TIERS.map(tier => {
            const c = TIER_CONFIG[tier]
            return (
              <div key={tier} className="flex items-center gap-1.5" title={c.description}>
                <div className="w-3 h-3 rounded-sm" style={{ background: c.bg }} />
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{c.label}</span>
              </div>
            )
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }} />
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Available</span>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          ⛔ <strong>Invariant</strong> slots are treated as physically impossible by the auto-scheduler — it will never place a lesson there, even if the schedule is tight.
        </p>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between pt-3 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              {markedCount} slot{markedCount !== 1 ? 's' : ''} marked unavailable
            </span>
            {markedCount > 0 && (
              <button
                onClick={clearAll}
                className="text-[12px] underline"
                style={{ color: '#ef4444' }}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>

      </div>
    </Modal>
  )
}
