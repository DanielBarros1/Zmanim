/**
 * fix-hours.ts — one-time backfill: halve all lesson hoursPerWeek values.
 *
 * The XLSX import double-counted hours (e.g. a 3-hr lesson was imported as 6).
 * This script divides every lesson's hoursPerWeek by 2, rounding down.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/fix-hours.ts
 *
 * The script is idempotent only in the sense that it shows you the before/after
 * values — run it ONCE and check the output.
 */

import 'dotenv/config'
import { prisma } from '../src/db'

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Zmanim — Fix lesson hoursPerWeek (÷ 2)'))
  console.log(bold('══════════════════════════════════════════════════════\n'))

  const lessons = await prisma.lesson.findMany({
    include: { subject: true, teacher: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`  Found ${lessons.length} lessons to update.\n`)
  console.log(dim(`  ${'ID'.padEnd(8)} ${'Subject'.padEnd(28)} ${'Teacher'.padEnd(24)} Before → After`))
  console.log(dim('  ' + '─'.repeat(72)))

  let updated = 0
  for (const lesson of lessons) {
    const before = lesson.hoursPerWeek
    const after  = Math.max(1, Math.floor(before / 2))  // never go below 1

    console.log(`  ${lesson.id.slice(-8)} ${(lesson.subject?.name ?? '?').padEnd(28)} ${(lesson.teacher?.name ?? '?').padEnd(24)} ${before} → ${green(String(after))}`)

    await prisma.lesson.update({
      where: { id: lesson.id },
      data:  { hoursPerWeek: after },
    })
    updated++
  }

  console.log(dim('\n  ' + '─'.repeat(72)))
  console.log(`\n  ${green('✓')} Updated ${bold(String(updated))} lessons.\n`)
  console.log(bold('══════════════════════════════════════════════════════\n'))
}

main()
  .catch(err => { console.error('\nFatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
