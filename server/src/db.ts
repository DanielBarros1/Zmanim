/**
 * Prisma client singleton
 * Import { prisma } from './db' in any route or service.
 */

import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
})
