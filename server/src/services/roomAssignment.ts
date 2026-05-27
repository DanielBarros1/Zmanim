/**
 * Auto room assignment
 *
 * When a lesson is placed without an explicit roomId, this service
 * picks the best available room using the following priority:
 *
 *   1. Subject has a specialized room → always use it (D6 invariant)
 *   2. Lesson is SHARED → find a free LARGE room
 *   3. Otherwise → find any free STANDARD or LARGE room
 *
 * Returns null if no suitable room is available (placement proceeds without
 * a room; a warning is surfaced in the evaluation result).
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

export async function autoAssignRoom(input: AutoAssignInput): Promise<string | null> {
  const { scheduleId, lessonId, day, slot, excludeEntryId } = input

  // Get lesson with subject (for specialized room) and type (for SHARED)
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { subject: true },
  })

  // ── Rule 1: specialized room ──────────────────────────────────
  if (lesson.subject.specializedRoomId) {
    return lesson.subject.specializedRoomId
  }

  // ── Find rooms occupied at this (day, slot) ───────────────────
  const occupiedEntries = await prisma.scheduleEntry.findMany({
    where: {
      scheduleId,
      day: day as any,
      slot,
      roomId: { not: null },
      ...(excludeEntryId && { NOT: { id: excludeEntryId } }),
    },
    select: { roomId: true },
  })
  const occupiedRoomIds = new Set(occupiedEntries.map(e => e.roomId!))

  // ── Rule 2: SHARED lesson → prefer LARGE room ─────────────────
  if (lesson.type === 'SHARED') {
    const largeRoom = await prisma.room.findFirst({
      where: {
        capacity: 'LARGE',
        id: { notIn: [...occupiedRoomIds] },
      },
      orderBy: { name: 'asc' },
    })
    if (largeRoom) return largeRoom.id
  }

  // ── Rule 3: any free room ─────────────────────────────────────
  const anyRoom = await prisma.room.findFirst({
    where: { id: { notIn: [...occupiedRoomIds] } },
    orderBy: [{ capacity: 'asc' }, { name: 'asc' }], // prefer STANDARD before LARGE for regular lessons
  })
  return anyRoom?.id ?? null
}
