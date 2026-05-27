/**
 * ViolationConfirmModal — override acknowledgment dialog.
 *
 * Shown when a placement would create violations that the admin must
 * explicitly acknowledge before proceeding. This is the "reactive override"
 * flow described in the product spec.
 *
 * For NON_NEGOTIABLE violations, the warning is more prominent (red).
 * The admin can proceed anyway — we never hard-block (product-spec.md §5).
 *
 * The admin may add an optional note explaining the override reason.
 * This note is stored with the Override record.
 */

import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import type { ClientViolation } from '../../lib/evaluator'
import { RestrictionTier } from '@zmanim/shared'

interface ViolationConfirmModalProps {
  open: boolean
  violations: ClientViolation[]
  onConfirm: (note?: string) => void
  onCancel: () => void
  isLoading?: boolean
}

export function ViolationConfirmModal({
  open,
  violations,
  onConfirm,
  onCancel,
  isLoading,
}: ViolationConfirmModalProps) {
  const [note, setNote] = useState('')
  const hasHard = violations.some(v => v.tier === RestrictionTier.NON_NEGOTIABLE)

  const handleConfirm = () => {
    onConfirm(note.trim() || undefined)
    setNote('')
  }

  const handleCancel = () => {
    setNote('')
    onCancel()
  }

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Constraint Violations Detected"
      width="max-w-md"
    >
      {/* Warning header */}
      <div
        className="rounded-lg p-3 mb-4 text-[12px]"
        style={{
          background: hasHard ? '#FEE2E2' : 'var(--warn-bg)',
          border: `1px solid ${hasHard ? '#FCA5A5' : 'var(--warn-border)'}`,
          color: hasHard ? '#B91C1C' : 'var(--warn-text)',
        }}
      >
        <p className="font-semibold mb-1">
          {hasHard ? '⛔ Hard constraint violated' : '⚠ Soft constraints violated'}
        </p>
        <p>
          {hasHard
            ? 'This placement violates a non-negotiable constraint. Placing here anyway will require an explicit override.'
            : 'This placement violates one or more scheduling preferences. You can proceed or choose a different slot.'}
        </p>
      </div>

      {/* Violation list */}
      <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
        {violations.map((v, i) => (
          <div
            key={i}
            className="flex items-start gap-2 p-2 rounded text-[12px]"
            style={{ background: 'var(--surface-2)' }}
          >
            <Badge
              variant={
                v.tier === RestrictionTier.NON_NEGOTIABLE ? 'warn' : 'accent'
              }
            >
              {v.tier.replace('_', ' ')}
            </Badge>
            <span style={{ color: 'var(--text-1)' }}>{v.message}</span>
          </div>
        ))}
      </div>

      {/* Note */}
      <div className="mb-4">
        <label className="text-[12px] font-medium text-[var(--text-2)]">
          Override note (optional)
        </label>
        <textarea
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text-1)] focus:outline-none focus:border-[var(--accent)] resize-none"
          rows={2}
          placeholder="Reason for overriding this constraint…"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
          Choose Different Slot
        </Button>
        <Button
          variant={hasHard ? 'danger' : 'primary'}
          onClick={handleConfirm}
          loading={isLoading}
        >
          {hasHard ? 'Override & Place Anyway' : 'Place with Override'}
        </Button>
      </div>
    </Modal>
  )
}
