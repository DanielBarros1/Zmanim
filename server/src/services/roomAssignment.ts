/**
 * Auto room assignment
 *
 * When a lesson is placed without an explicit roomId, this service
 * picks the best available room(s) using the following priority:
 *
 *   1. Subject has a specialized room → always use it (D6 invariant)
 *   2. Lesson is SHARED → find a free LARGE room
 *   3. Lesson is PARALLEL → find two distinct free rooms (one per class-teacher pair)
 *   4. Otherwise → find any free STANDARD or LARGE room
 *
 * Returns { roomId, roomId2 }.
 *   roomId2 is only populated for PARALLEL lessons.
 *   Either field may be null if no suitable room is available (placement
 *   proceeds without a room; a warning is surfaced in the evaluation result).
 */

import { prisma } from '../db'

interface AutoAssignInput {
  scheduleId: string
  lessonId: string
  day: string
  slot: number
  /** When moving an entry, exclude its own ID from the "occupied" check */
  excludeEntryId?: string
}

export interface RoomAssignment {
  roomId: string | null
  roomId2: string | null
}

export async function autoAssignRoom(input: AutoAssignInput): Promise<RoomAssignment> {
  const { scheduleId, lessonId, day, slot, excludeEntryId } = input

  // Get lesson with subject (for specialized room) and type
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { subject: true },
  })

  // ── Rule 1: specialized room ──────────────────────────────────
  if (lesson.subject.specializedRoomId) {
    return { roomId: lesson.subject.specializedRoomId, roomId2: null }
  }

  // ── Find rooms occupied at this (day, slot) ───────────────────
  // Both roomId and roomId2 can be occupied, so collect both columns.
  const occupiedEntries = await prisma.scheduleEntry.findMany({
    where: {
      scheduleId,
      day: day as any,
      slot,
      ...(excludeEntryId && { NOT: { id: excludeEntryId } }),
    },
    select: { roomId: true, roomId2: true },
  })
  const occupiedRoomIds = new Set<string>()
  for (const e of occupiedEntries) {
    if (e.roomId)  occupiedRoomIds.add(e.roomId)
    if (e.roomId2) occupiedRoomIds.add(e.roomId2)
  }

  // ── Rule 2: SHARED lesson → prefer LARGE room ─────────────────
  if (lesson.type === 'SHARED') {
    const largeRoom = await prisma.room.findFirst({
      where: { capacity: 'LARGE', id: { notIn: [...occupiedRoomIds] } },
      orderBy: { name: 'asc' },
    })
    if (largeRoom) return { roomId: largeRoom.id, roomId2: null }
  }

  // ── Rule 3: PARALLEL lesson → two distinct free rooms ─────────
  if (lesson.type === 'PARALLEL') {
    const room1 = await prisma.room.findFirst({
      where: { id: { notIn: [...occupiedRoomIds] } },
      orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
    })
    const takenAfterRoom1 = new Set(occupiedRoomIds)
    if (room1) takenAfterRoom1.add(room1.id)
    const room2 = await prisma.room.findFirst({
      where: { id: { notIn: [...takenAfterRoom1] } },
      orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
    })
    return { roomId: room1?.id ?? null, roomId2: room2?.id ?? null }
  }

  // ── Rule 4: any free room ─────────────────────────────────────
  const anyRoom = await prisma.room.findFirst({
    where: { id: { notIn: [...occupiedRoomIds] } },
    orderBy: [{ capacity: 'asc' }, { name: 'asc' }],
  })
  return { roomId: anyRoom?.id ?? null, roomId2: null }
}
