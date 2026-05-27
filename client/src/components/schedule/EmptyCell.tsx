/**
 * EmptyCell — a drop target in the schedule grid.
 *
 * Visual design (from design-spec.md §6):
 *   - Dashed border (1.5px dashed var(--border))
 *   - '+' centered in muted color
 *   - Hover: border + icon turn accent blue (signals droppability)
 *   - isOver (drag over): accent background fill
 *
 * Uses useDroppable from @dnd-kit/core.
 * The droppable id encodes the target cell: `cell-${day}-${slot}-${classId}`.
 */

import { useDroppable } from '@dnd-kit/core'
import type { Day } from '@zmanim/shared'

interface EmptyCellProps {
  day: Day
  slot: number
  classId: string
  /** Callback when user wants to manually pick a lesson for this cell */
  onClick?: () => void
  disabled?: boolean
}

export function EmptyCell({ day, slot, classId, onClick, disabled }: EmptyCellProps) {
  const droppableId = `cell-${day}-${slot}-${classId}`
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { day, slot, classId },
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className="group flex items-center justify-center rounded-[5px] w-full h-full min-h-[64px] cursor-pointer transition-all"
      style={{
        border: isOver
          ? '1.5px solid var(--accent)'
          : '1.5px dashed var(--border)',
        background: isOver ? 'var(--accent-bg)' : 'transparent',
      }}
      title="Drop lesson here or click to place"
    >
      <span
        className="text-lg font-light transition-colors"
        style={{ color: isOver ? 'var(--accent)' : 'var(--recess-text)' }}
      >
        +
      </span>
    </div>
  )
}
