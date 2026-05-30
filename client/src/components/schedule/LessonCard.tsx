/**
 * LessonCard — a placed lesson in the schedule grid.
 *
 * Visual design (from design-spec.md §6):
 *   - White background (var(--card-bg) in dark mode)
 *   - 3px left border in the subject's color
 *   - Rounded corners (5px)
 *   - Subtle box shadow
 *   - Subject name (Hebrew, RTL, bold, 12.5px)
 *   - Teacher name (Hebrew, RTL, muted, 11px)
 *   - Room badge: shows assigned room; click opens RoomPopover to change
 *   - Optional tags: lesson type, math level, violations
 *   - Warning state: amber left border + warn-bg background
 *
 * Interaction:
 *   - useDraggable from @dnd-kit/core for drag-to-move
 *   - × button on the LEFT (RTL — Hebrew content is right-aligned)
 *   - Violation badge shows tooltip on hover listing all active violations
 *   - Click room badge → RoomPopover for room override
 */

import { useState, useRef, useCallback } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { ScheduleEntry, Lesson, Subject, Teacher, Room } from '@zmanim/shared'
import { LessonType, MATH_LEVEL_LABEL } from '@zmanim/shared'
import type { Violation } from '@zmanim/shared'
import { useScheduleStore } from '../../store/scheduleStore'
import { RoomPopover } from './RoomPopover'

interface LessonCardProps {
  entry: ScheduleEntry
  lesson: Lesson
  subject: Subject | undefined
  teacher: Teacher | undefined
  violations: Violation[]
  rooms: Room[]
  /**
   * For PARALLEL lessons: the class column this card is rendered in.
   * When set, the card shows that class's specific teacher and room instead
   * of the combined "Teacher A · Teacher B" label.
   */
  displayClassId?: string
  onRemove: () => void
  onChangeRoom: (entryId: string, roomId: string | null, which?: 1 | 2) => void
  isReviewMode?: boolean
}

export function LessonCard({
  entry,
  lesson,
  subject,
  teacher,
  violations,
  rooms,
  displayClassId,
  onRemove,
  onChangeRoom,
  isReviewMode,
}: LessonCardProps) {
  const { highlightedEntryIds } = useScheduleStore()
  const isHighlighted = highlightedEntryIds.includes(entry.id)

  // Only count violations that haven't been explicitly overridden by the admin.
  // Overridden violations are acknowledged; they should not drive the card colour.
  const activeViolations = violations.filter(v => !v.isOverridden)
  const hasViolation = activeViolations.length > 0
  const hasHardViolation = activeViolations.some(v => v.tier === 'NON_NEGOTIABLE')

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `entry-${entry.id}`,
    data: { type: 'entry', entryId: entry.id, lessonId: lesson.id },
    disabled: isReviewMode || entry.isSeeded,
  })

  const isParallel = lesson.type === LessonType.PARALLEL

  // For PARALLEL: determine which room to show based on the class column this card is in.
  // classIndex 0 → roomId (class A), classIndex 1 → roomId2 (class B).
  // Teacher is already resolved per-class by ScheduleGrid — no lookup needed here.
  const parallelClassIndex = isParallel && displayClassId
    ? lesson.classIds.indexOf(displayClassId)
    : -1

  // Room popover state — separate state for primary and secondary room (PARALLEL)
  const [roomPopoverOpen,  setRoomPopoverOpen]  = useState(false)
  const [roomPopover2Open, setRoomPopover2Open] = useState(false)
  const roomBadgeRef  = useRef<HTMLButtonElement>(null)
  const roomBadge2Ref = useRef<HTMLButtonElement>(null)

  // For PARALLEL with a known class column: show only that class's room
  const showRoomId  = isParallel && parallelClassIndex === 1 ? entry.roomId2 : entry.roomId
  const showWhich   = isParallel && parallelClassIndex === 1 ? 2 : 1
  const currentRoom  = rooms.find(r => r.id === showRoomId) ?? null
  const currentRoom2 = rooms.find(r => r.id === entry.roomId2) ?? null

  // No-room indicator: true when the room that should be shown is unassigned
  const hasNoRoom = !showRoomId

  // Violation tooltip — JS-driven with a close delay so the mouse can travel
  // from the badge into the tooltip without it flickering closed.
  // (CSS group-hover loses state as soon as the pointer leaves the group's
  // layout bounds, which happens the moment it enters the absolutely-positioned
  // tooltip panel above the card.)
  const [showViolTooltip, setShowViolTooltip] = useState(false)
  const violTooltipTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openViolTooltip = useCallback(() => {
    clearTimeout(violTooltipTimer.current)
    setShowViolTooltip(true)
  }, [])
  const closeViolTooltip = useCallback(() => {
    violTooltipTimer.current = setTimeout(() => setShowViolTooltip(false), 120)
  }, [])

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 100 : undefined,
  }

  const borderColor = hasHardViolation
    ? '#EF4444'   // red for hard violations
    : hasViolation
    ? '#F59E0B'   // amber for soft violations
    : subject?.color ?? '#94A3B8'

  // Highlight takes priority over warn-bg so the admin can clearly see which
  // entry the violation panel is pointing at, even when it has a hard violation.
  const bgColor = isHighlighted
    ? 'var(--accent-bg)'
    : hasHardViolation
    ? 'var(--warn-bg)'
    : 'var(--card-bg)'

  const isDraggable = !isReviewMode && !entry.isSeeded

  return (
    <div
      ref={setNodeRef}
      data-entry-id={entry.id}
      style={{
        ...style,
        borderLeft: `3px solid ${borderColor}`,
        background: bgColor,
        touchAction: isDraggable ? 'none' : undefined,
        // Ring outline drawn via boxShadow so it shows regardless of bgColor and
        // never collapses card width (outline would be clipped by overflow:hidden parents).
        boxShadow: isHighlighted
          ? '0 0 0 2px var(--accent), 0 2px 8px rgba(0,0,0,0.08)'
          : undefined,
      }}
      className="relative rounded-[5px] p-1.5 select-none w-full"
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
    >
      {/* ── Remove button — LEFT side (content is Hebrew/RTL) ── */}
      {isDraggable && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="absolute top-1 left-1 w-4 h-4 flex items-center justify-center rounded
            opacity-0 hover:opacity-100 group-hover:opacity-100 transition-opacity text-[10px]"
          style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
          title="Remove placement"
          aria-label="Remove"
        >
          ×
        </button>
      )}

      {/* ── Text content — left-padded to clear the × button ── */}
      <div className={`min-w-0 ${isDraggable ? 'pl-4' : ''}`}>
        <p
          className="text-[12.5px] font-bold truncate hebrew leading-tight"
          style={{ color: 'var(--text-1)' }}
          title={subject?.name}
        >
          {subject?.name ?? '—'}
        </p>
        <p
          className="text-[11px] truncate hebrew"
          style={{ color: 'var(--text-2)' }}
          title={teacher?.name}
        >
          {teacher?.name ?? '—'}
        </p>
      </div>

      {/* ── Room badge(s) — click to change ── */}
      {!isReviewMode && (
        <div className="mt-0.5 flex gap-1 flex-wrap">
          {/* Primary room badge (or per-class room for PARALLEL in a specific column) */}
          <button
            ref={roomBadgeRef}
            onClick={e => { e.stopPropagation(); setRoomPopoverOpen(o => !o) }}
            className="flex items-center max-w-full"
            title={isParallel && parallelClassIndex >= 0
              ? `Class ${parallelClassIndex === 0 ? 'A' : 'B'} room — click to change`
              : 'Click to change room'}
          >
            <span
              className="text-[10px] px-1 py-px rounded truncate max-w-full hover:brightness-95 transition-all"
              style={{
                background: hasNoRoom ? '#FEF3C7' : 'var(--surface-2)',
                color:      hasNoRoom ? '#92400E' : currentRoom ? 'var(--text-2)' : 'var(--text-3)',
              }}
            >
              {hasNoRoom ? '⚠ No room' : currentRoom!.name}
            </span>
          </button>

          {/* Second room badge — only for PARALLEL when NOT in a specific column */}
          {isParallel && parallelClassIndex < 0 && (
            <button
              ref={roomBadge2Ref}
              onClick={e => { e.stopPropagation(); setRoomPopover2Open(o => !o) }}
              className="flex items-center max-w-full"
              title="Class B room — click to change"
            >
              <span
                className="text-[10px] px-1 py-px rounded truncate max-w-full hover:brightness-95 transition-all"
                style={{
                  background: !entry.roomId2 ? '#FEF3C7' : 'var(--surface-2)',
                  color:      !entry.roomId2 ? '#92400E' : currentRoom2 ? 'var(--text-2)' : 'var(--text-3)',
                }}
              >
                {!entry.roomId2 ? '⚠ No room (B)' : `B: ${currentRoom2!.name}`}
              </span>
            </button>
          )}
        </div>
      )}

      {/* ── Tags row ── */}
      <div className="flex gap-1 mt-1 flex-wrap">
        {lesson.type === LessonType.SHARED && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
          >
            Shared
          </span>
        )}
        {lesson.type === LessonType.MATH_GROUP && lesson.mathLevel && (
          // Violet — distinct from both the yellow violation badge and the blue shared badge
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: '#F5F3FF', color: '#6D28D9' }}
          >
            {MATH_LEVEL_LABEL[lesson.mathLevel]}
          </span>
        )}
        {lesson.type === LessonType.ENGLISH_GROUP && lesson.englishLevel && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
          >
            {MATH_LEVEL_LABEL[lesson.englishLevel]}
          </span>
        )}
        {entry.isSeeded && (
          <span
            className="text-[9px] font-semibold px-1 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            Seeded
          </span>
        )}

        {/* ── Violation badge with hover tooltip ── */}
        {hasViolation && (
          <div className="relative">
            {/* Badge — hover triggers tooltip open */}
            <span
              className="text-[9px] font-semibold px-1 rounded cursor-help"
              style={{
                background: hasHardViolation ? '#FEE2E2' : 'var(--warn-badge)',
                color: hasHardViolation ? '#B91C1C' : 'var(--warn-text)',
              }}
              onMouseEnter={openViolTooltip}
              onMouseLeave={closeViolTooltip}
            >
              {hasHardViolation ? '⛔' : '⚠'} {activeViolations.length}
            </span>

            {/* Tooltip panel — JS-controlled so hovering it keeps it open.
                Positioned above the badge; the card's overflow:visible lets it
                escape the card bounds without being clipped. */}
            {showViolTooltip && (
              <div
                className="
                  absolute bottom-full left-0 mb-1 z-[500]
                  w-max max-w-[220px] min-w-[160px]
                  rounded-lg shadow-xl border border-[var(--border)]
                  p-2 space-y-1
                "
                style={{ background: 'var(--surface)' }}
                onMouseEnter={openViolTooltip}
                onMouseLeave={closeViolTooltip}
              >
                {activeViolations.map((v, i) => (
                  <p
                    key={i}
                    className="text-[11px] leading-snug"
                    style={{ color: 'var(--text-1)' }}
                  >
                    <span className="mr-1">
                      {v.tier === 'NON_NEGOTIABLE' ? '⛔' : '⚠'}
                    </span>
                    {v.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Room popovers ── */}
      {roomPopoverOpen && roomBadgeRef.current && (
        <RoomPopover
          rooms={rooms}
          currentRoomId={showRoomId}
          anchorEl={roomBadgeRef.current}
          onSelect={roomId => onChangeRoom(entry.id, roomId, showWhich)}
          onClose={() => setRoomPopoverOpen(false)}
        />
      )}
      {roomPopover2Open && roomBadge2Ref.current && (
        <RoomPopover
          rooms={rooms}
          currentRoomId={entry.roomId2}
          anchorEl={roomBadge2Ref.current}
          onSelect={roomId => onChangeRoom(entry.id, roomId, 2)}
          onClose={() => setRoomPopover2Open(false)}
        />
      )}
    </div>
  )
}
