/**
 * RoomPopover — portal-based room picker that opens when the user clicks
 * the room badge on a LessonCard.
 *
 * Rendered into document.body via createPortal so it is never clipped by
 * the overflow:auto scroll containers in the schedule grid.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Room, ScheduleEntry, Day } from '@zmanim/shared'

interface RoomPopoverProps {
  rooms: Room[]
  currentRoomId: string | null
  /** The badge button element — used to compute the popover's position */
  anchorEl: HTMLElement
  /** Current day and slot for checking room availability */
  day?: Day
  slot?: number
  /** All entries in the schedule to check which rooms are occupied */
  entries?: ScheduleEntry[]
  onSelect: (roomId: string | null) => void
  onClose: () => void
}

export function RoomPopover({
  rooms,
  currentRoomId,
  anchorEl,
  day,
  slot,
  entries,
  onSelect,
  onClose,
}: RoomPopoverProps) {
  const [search, setSearch] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  // Compute which rooms are occupied at the current time slot
  const occupiedRoomIds = new Set<string>()
  if (day !== undefined && slot !== undefined && entries) {
    const occupyingEntries = entries.filter(e => e.day === day && e.slot === slot)
    occupyingEntries.forEach(e => {
      if (e.roomId) occupiedRoomIds.add(e.roomId)
      if (e.roomId2) occupiedRoomIds.add(e.roomId2)
    })
  }

  // Compute position anchored below the badge button
  const rect = anchorEl.getBoundingClientRect()
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 4,
    left: rect.left,
    zIndex: 9999,
    minWidth: 180,
    maxWidth: 240,
  }

  // Flip above if the popover would go off-screen
  const wouldOverflowBottom = rect.bottom + 4 + 200 > window.innerHeight
  if (wouldOverflowBottom) {
    style.top = undefined
    style.bottom = window.innerHeight - rect.top + 4
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    // Use mousedown so the popover closes before any subsequent click outside
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [anchorEl, onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = rooms.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  )

  // Sort: free rooms first, then occupied
  const freeRooms = filtered.filter(r => !occupiedRoomIds.has(r.id) || currentRoomId === r.id)
  const occupiedRooms = filtered.filter(r => occupiedRoomIds.has(r.id) && currentRoomId !== r.id)

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className="rounded-lg shadow-xl border border-[var(--border)] overflow-hidden"
      // Stop propagation so clicks inside don't bubble up to DnD listeners
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Search bar */}
      <div
        className="px-2 py-1.5 border-b border-[var(--border)]"
        style={{ background: 'var(--surface-2)' }}
      >
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rooms…"
          className="w-full text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--text-1)' }}
        />
      </div>

      {/* Room list */}
      <ul
        className="max-h-44 overflow-y-auto"
        style={{ background: 'var(--surface)' }}
      >
        {/* "No room" option */}
        <li
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
          style={{ color: currentRoomId === null ? 'var(--accent)' : 'var(--text-3)' }}
          onClick={() => { onSelect(null); onClose() }}
        >
          {currentRoomId === null && <span className="text-[10px]">✓</span>}
          <span className={currentRoomId !== null ? 'ml-[14px]' : ''}>No room</span>
        </li>

        {freeRooms.map(room => (
          <li
            key={room.id}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[var(--surface-2)] transition-colors hebrew"
            style={{
              color: room.id === currentRoomId ? 'var(--accent)' : 'var(--text-1)',
            }}
            onClick={() => { onSelect(room.id); onClose() }}
          >
            {room.id === currentRoomId
              ? <span className="text-[10px] flex-shrink-0">✓</span>
              : <span className="w-[14px] flex-shrink-0" />
            }
            {room.name}
          </li>
        ))}

        {/* Occupied rooms section */}
        {occupiedRooms.length > 0 && (
          <>
            <li
              className="px-3 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
            >
              Occupied at this time:
            </li>
            {occupiedRooms.map(room => (
              <li
                key={room.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-not-allowed hebrew"
                style={{
                  color: 'var(--text-3)',
                  opacity: 0.5,
                  background: 'rgba(239, 68, 68, 0.1)',
                }}
                title={`This room is occupied at this time slot`}
              >
                <span className="w-[14px] flex-shrink-0" />
                {room.name}
              </li>
            ))}
          </>
        )}

        {filtered.length === 0 && (
          <li
            className="px-3 py-3 text-[11px] text-center"
            style={{ color: 'var(--text-3)' }}
          >
            No rooms match
          </li>
        )}
      </ul>
    </div>,
    document.body,
  )
}
