/**
 * test-scheduler.ts — standalone scheduler diagnostic script
 *
 * Runs the auto-scheduler directly (no HTTP, no auth), evaluates violations,
 * prints a detailed report, then deletes the test schedule from the DB.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/test-scheduler.ts [restarts] [iterations]
 *
 * Defaults: 3 restarts, 1000 iterations (fast; bump for production quality)
 */

import 'dotenv/config'
import { prisma } from '../src/db'
import { startAutoSchedulerJob, getJob } from '../src/services/autoscheduler'
import { evaluate } from '../src/services/evaluator'

const N_RESTARTS  = parseInt(process.argv[2] ?? '3',    10)
const N_ITER      = parseInt(process.argv[3] ?? '1000', 10)
const JOB_ID      = `diag-${Date.now()}`
const SCHEDULE_NAME = `[DIAGNOSTIC] ${new Date().toISOString()}`

// ── Colour helpers ────────────────────────────────────────────────────────────
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`

async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Zmanim Auto-Scheduler Diagnostic'))
  console.log(bold(`  ${N_RESTARTS} restarts × ${N_ITER} iterations`))
  console.log(bold('══════════════════════════════════════════════════════\n'))

  // ── Kick off the scheduler ──────────────────────────────────────────────────
  startAutoSchedulerJob({
    jobId:       JOB_ID,
    name:        SCHEDULE_NAME,
    nRestarts:   N_RESTARTS,
    nIterations: N_ITER,
  })

  // ── Poll until done ─────────────────────────────────────────────────────────
  process.stdout.write('  Scheduling ')
  let scheduleId: string | undefined
  while (true) {
    await new Promise(r => setTimeout(r, 400))
    const job = getJob(JOB_ID)
    if (!job) { console.log(red('\nJob disappeared!')); process.exit(1) }
    process.stdout.write('.')
    if (job.status === 'ERROR') {
      console.log(red(`\nScheduler error: ${job.error}`))
      process.exit(1)
    }
    if (job.status === 'DONE') {
      scheduleId = job.scheduleId
      console.log(green(' done\n'))
      break
    }
  }

  if (!scheduleId) { console.log(red('No scheduleId on completed job')); process.exit(1) }

  // ── Load the created schedule ───────────────────────────────────────────────
  const [schedule, lessons, restrictions, config] = await Promise.all([
    prisma.schedule.findUniqueOrThrow({
      where: { id: scheduleId },
      include: {
        entries: {
          include: {
            lesson: { include: { classes: true, subject: true, grade: true, teacher: true } },
            overrides: true,
          },
        },
      },
    }),
    prisma.lesson.findMany({ include: { classes: true, subject: true, grade: true } }),
    prisma.restriction.findMany({ where: { isActive: true } }),
    prisma.schoolConfig.findFirst(),
  ])

  const slotsPerDay = config?.slotsPerDay ?? 4

  // ── Evaluate ────────────────────────────────────────────────────────────────
  const result = evaluate({
    entries:      schedule.entries as any,
    lessons,
    restrictions: restrictions as any,
    config:       { slotsPerDay },
    overrides:    [],
  })

  const active = result.violations.filter(v => !v.isOverridden)

  // ── Violation summary by type ───────────────────────────────────────────────
  console.log(bold('── Violation summary ──────────────────────────────────'))
  const byType = new Map<string, number>()
  for (const v of active) byType.set(v.restrictionType, (byType.get(v.restrictionType) ?? 0) + 1)

  if (byType.size === 0) {
    console.log(green('  ✓ No violations! Schedule is perfect.'))
  } else {
    const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1])
    for (const [type, count] of sorted) {
      const tier = active.find(v => v.restrictionType === type)?.tier
      const colour = tier === 'NON_NEGOTIABLE' ? red : tier === 'IMPORTANT' ? yellow : dim
      console.log(`  ${colour(type.padEnd(38))} × ${String(count).padStart(3)}`)
    }
  }
  console.log(`\n  Total active violations: ${bold(String(active.length))}`)
  console.log(`  Score:                  ${bold(String(result.score))}`)

  // ── Class double-booking detail ─────────────────────────────────────────────
  const classDB = active.filter(v => v.restrictionType === 'CLASS_DOUBLE_BOOKED')
  if (classDB.length > 0) {
    console.log(bold('\n── Class double-booked slots ──────────────────────────'))
    for (const v of classDB) {
      const affected = schedule.entries.filter(e => v.affectedEntryIds.includes(e.id)) as any[]
      const slotStr  = affected[0] ? `${affected[0].day} slot ${affected[0].slot}` : '?'
      const names    = affected.map(e => `${e.lesson.subject?.name ?? '?'} (${e.lesson.type})`).join(', ')
      console.log(`  ${red('⛔')} ${slotStr}: ${names}`)
    }
  }

  // ── Regular-at-group-slot detection ────────────────────────────────────────
  const groupKeys = new Set<string>()
  for (const e of schedule.entries as any[]) {
    if (e.lesson.type === 'MATH_GROUP' || e.lesson.type === 'ENGLISH_GROUP') {
      for (const cls of e.lesson.classes) groupKeys.add(`${cls.id}:${e.day}:${e.slot}`)
    }
  }
  const regularAtGroup: any[] = []
  for (const e of schedule.entries as any[]) {
    if (e.lesson.type !== 'REGULAR' && e.lesson.type !== 'SHARED') continue
    for (const cls of e.lesson.classes) {
      if (groupKeys.has(`${cls.id}:${e.day}:${e.slot}`)) {
        regularAtGroup.push({ entry: e, classId: cls.id })
        break
      }
    }
  }
  if (regularAtGroup.length > 0) {
    console.log(bold('\n── Regular lessons at group slots ─────────────────────'))
    for (const { entry: e, classId } of regularAtGroup) {
      console.log(`  ${red('⛔')} ${e.lesson.subject?.name} (${e.lesson.type}) at ${e.day} slot ${e.slot} — class ${classId.slice(-6)}`)
    }
  } else {
    console.log(green('\n  ✓ No regular lessons placed at group slots'))
  }

  // ── D3/D4 group-sync detail ────────────────────────────────────────────────
  const groupSync = active.filter(v =>
    v.restrictionType === 'MATH_GROUPS_NOT_SIMULTANEOUS' ||
    v.restrictionType === 'ENGLISH_GROUPS_NOT_SIMULTANEOUS'
  )
  if (groupSync.length > 0) {
    console.log(bold('\n── Group synchronisation violations ───────────────────'))
    for (const v of groupSync) console.log(`  ${red('⛔')} ${v.message}`)
  }

  // ── Teacher double-booking ─────────────────────────────────────────────────
  const teacherDB = active.filter(v => v.restrictionType === 'TEACHER_DOUBLE_BOOKED')
  if (teacherDB.length > 0) {
    console.log(bold('\n── Teacher double-booked ──────────────────────────────'))
    for (const v of teacherDB.slice(0, 10)) {
      const affected = schedule.entries.filter(e => v.affectedEntryIds.includes(e.id)) as any[]
      const slotStr  = affected[0] ? `${affected[0].day} slot ${affected[0].slot}` : '?'
      const teacher  = affected[0]?.lesson?.teacher?.name ?? '?'
      const names    = affected.map(e => e.lesson.subject?.name ?? '?').join(' + ')
      console.log(`  ${yellow('⚠')}  ${teacher}: ${names}  [${slotStr}]`)
    }
    if (teacherDB.length > 10) console.log(dim(`  … and ${teacherDB.length - 10} more`))
  }

  // ── Clean up ───────────────────────────────────────────────────────────────
  console.log(bold('\n── Cleanup ────────────────────────────────────────────'))
  await prisma.scheduleEntry.deleteMany({ where: { scheduleId } })
  await prisma.schedule.delete({ where: { id: scheduleId } })
  console.log(dim('  Test schedule deleted from DB'))
  console.log(bold('══════════════════════════════════════════════════════\n'))
}

main()
  .catch(err => { console.error(red('\nFatal error:'), err); process.exit(1) })
  .finally(() => prisma.$disconnect())
