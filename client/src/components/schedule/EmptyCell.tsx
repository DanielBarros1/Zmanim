/**
 * EmptyCell — a drop target in the schedule grid.
 *
 * Two separate mechanisms work together:
 *
 * 1. useDroppable (dnd-kit) — only used for the `isOver` visual highlight.
 *    Its collision detection can drift in nested overflow-auto containers,
 *    so we do NOT rely on over.data.current for the actual placement logic.
 *
 * 2. data-cell-* attributes — stamped on the root div so that
 *    ScheduleEditorPage.handleDragEnd can call document.elementsFromPoint()
 *    with the final pointer position and read the correct day/slot/classId
 *    directly from the DOM, bypassing dnd-kit's collision detection entirely.
 *    This is always pixel-perfect regardless of scroll or nested overflow.
 *
 * Drop-zone highlighting (validity prop):
 *   When the user picks up a lesson from the pool, ScheduleEditorPage
 *   computes a validity map for every cell and passes it down here via the
 *   ScheduleGrid.  Cells are coloured accordingly:
 *     'valid'     → green border + green tint  (no hard violations)
 *     'blocked'   → dim / red tint             (teacher or class conflict)
 *     'impossible'→ very dim, no drop target   (wrong class for this lesson)
 *     undefined   → default empty-cell style   (no drag in progress)
 */

import { useDroppable } from '@dnd-kit/core'
import type { Day } from '@zmanim/shared'

/**
 * valid      — no hard violations; encourage dropping here (green)
 * soft       — only soft/simultaneity violations; drop allowed with modal (amber)
 * blocked    — hard D1/D2 violation; teacher or class already occupied (red)
 * impossible — lesson's classIds don't include this column; can't land here (dim gray)
 */
export type CellValidity = 'valid' | 'soft' | 'blocked' | 'impossible'

interface EmptyCellProps {
  day: Day
  slot: number
  classId: string
  onClick?: () => void
  disabled?: boolean
  /** Computed by ScheduleEditorPage while a pool-lesson is being dragged */
  validity?: CellValidity
}

export function EmptyCell({ day, slot, classId, onClick, disabled, validity }: EmptyCellProps) {
  const droppableId = `cell-${day}-${slot}-${classId}`

  // Impossible cells are not valid drop targets — disable the droppable and
  // strip data-cell-* so elementsFromPoint() can't land on them.
  const isImpossible = validity === 'impossible'

  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { day, slot, classId },
    disabled: disabled || isImpossible,
  })

  // ── Visual style based on validity / hover state ──────────────
  let borderStyle: string
  let bgStyle: string
  let textColor: string

  if (isImpossible) {
    // Wrong class column for this lesson — neutral disabled look
    borderStyle = '1.5px dashed var(--border)'
    bgStyle = 'var(--surface-2)'
    textColor = 'transparent'   // hide the +
  } else if (validity === 'blocked') {
    // Hard D1/D2 violation — teacher or class already taken
    borderStyle = isOver ? '1.5px solid #EF4444' : '1.5px dashed #FCA5A5'
    bgStyle = isOver ? '#FEE2E2' : '#FEF2F2'
    textColor = '#EF4444'
  } else if (validity === 'soft') {
    // Simultaneity or other soft violation — droppable but a modal will appear
    borderStyle = isOver ? '1.5px solid #F59E0B' : '1.5px dashed #FCD34D'
    bgStyle = isOver ? '#FFFBEB' : '#FFFDF5'
    textColor = isOver ? '#D97706' : '#FCD34D'
  } else if (validity === 'valid') {
    // Clean slot — invite the drop
    borderStyle = isOver ? '1.5px solid #22C55E' : '1.5px dashed #86EFAC'
    bgStyle = isOver ? '#F0FDF4' : '#F7FEF9'
    textColor = isOver ? '#16A34A' : '#86EFAC'
  } else {
    // Default — no drag in progress
    borderStyle = isOver ? '1.5px solid var(--accent)' : '1.5px dashed var(--border)'
    bgStyle = isOver ? 'var(--accent-bg)' : 'transparent'
    textColor = isOver ? 'var(--accent)' : 'var(--recess-text)'
  }

  // data-cell-* attributes enable pixel-accurate drop detection via
  // elementsFromPoint(). Strip them from impossible cells so the DnD handler
  // can't accidentally use them as drop targets.
  const cellDataProps = isImpossible ? {} : {
    'data-cell-day': day,
    'data-cell-slot': String(slot),
    'data-cell-class-id': classId,
  }

  return (
    <div
      ref={setNodeRef}
      onClick={isImpossible ? undefined : onClick}
      {...cellDataProps}
      className="flex items-center justify-center rounded-[5px] w-full h-full min-h-[64px] transition-all"
      style={{
        border: borderStyle,
        background: bgStyle,
        cursor: isImpossible ? 'not-allowed' : 'pointer',
        opacity: isImpossible ? 0.35 : 1,
      }}
      title={
        validity === 'blocked'
          ? 'A conflict prevents placing here'
          : validity === 'impossible'
          ? 'This lesson cannot go in this class column'
          : 'Drop lesson here'
      }
    >
      <span
        className="text-lg font-light transition-colors"
        style={{ color: textColor }}
      >
        +
      </span>
    </div>
  )
}
