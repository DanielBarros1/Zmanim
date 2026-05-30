/**
 * Rooms routes — CRUD
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const roomsRouter = Router()

roomsRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({ orderBy: { name: 'asc' } })
    res.json(rooms)
  } catch (err) { next(err) }
})

const roomSchema = z.object({
  name: z.string().min(1),
  capacity: z.enum(['STANDARD', 'LARGE']).default('STANDARD'),
})

roomsRouter.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = roomSchema.parse(req.body)
    const room = await prisma.room.create({ data })
    res.status(201).json(room)
  } catch (err) { next(err) }
})

roomsRouter.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = roomSchema.partial().parse(req.body)
    const room = await prisma.room.update({ where: { id: req.params.id }, data })
    res.json(room)
  } catch (err) { next(err) }
})

roomsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id

    // Null out schedule entries that reference this room (keep entries, just unset room)
    await prisma.scheduleEntry.updateMany({ where: { roomId: id }, data: { roomId: null } })

    // Null out subjects that use this as their specialized room
    await prisma.subject.updateMany({ where: { specializedRoomId: id }, data: { specializedRoomId: null } })

    await prisma.room.delete({ where: { id } })
    res.status(204).send()
  } catch (err) { next(err) }
})
