/**
 * check-load.ts — per-class lesson load vs available schedule slots
 *
 * MATH_GROUP and ENGLISH_GROUP run simultaneously across all levels,
 * so only the max hoursPerWeek for the grade is counted per class.
 *
 * Usage: npx tsx scripts/check-load.ts
 */

import 'dotenv/config'
import { prisma } from '../src/db'

async function main() {
  const [lessons, config, classes] = await Promise.all([
    prisma.lesson.findMany({
      include: { classes: true, grade: true, subject: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.schoolConfig.findFirst(),
    prisma.class.findMany({
      include: { grade: true },
      orderBy: [{ grade: { number: 'asc' } }, { section: 'asc' }],
    }),
  ])

  const slotsPerDay  = config?.slotsPerDay ?? 4
  const workDays     = config?.workDays?.length ?? 5
  const totalSlots   = slotsPerDay * workDays

  console.log(`\nSchool config: ${slotsPerDay} slots/day × ${workDays} days = ${totalSlots} slots/class/week\n`)

  // For MATH_GROUP / ENGLISH_GROUP: max hoursPerWeek per grade
  // (all levels run at the same time — students redistribute, so only one slot is used)
  const mathMaxByGrade    = new Map<string, number>()
  const englishMaxByGrade = new Map<string, number>()
  for (const l of lessons) {
    if (l.type === 'MATH_GROUP' && l.gradeId)
      mathMaxByGrade.set(l.gradeId, Math.max(mathMaxByGrade.get(l.gradeId) ?? 0, l.hoursPerWeek))
    if (l.type === 'ENGLISH_GROUP' && l.gradeId)
      englishMaxByGrade.set(l.gradeId, Math.max(englishMaxByGrade.get(l.gradeId) ?? 0, l.hoursPerWeek))
  }

  const DIRECT_TYPES = ['REGULAR', 'SHARED', 'PARALLEL', 'MULTI_TEACHER']

  // Header
  const h = (s: string, w: number) => s.padEnd(w)
  console.log(
    h('Class', 7) + h('Direct hrs', 12) + h('Math★', 7) + h('Eng★', 7) +
    h('Total', 7) + h(`/ ${totalSlots}`, 6) + 'Status'
  )
  console.log('─'.repeat(60))

  let anyOver  = false
  let anyTight = false

  for (const cls of classes) {
    const label = `${cls.grade.number}${cls.section}`

    // Direct hours: all lesson types that assign slots directly to this class
    const directHours = lessons
      .filter(l => DIRECT_TYPES.includes(l.type) && l.classes.some(c => c.id === cls.id))
      .reduce((sum, l) => sum + l.hoursPerWeek, 0)

    const mathHrs = mathMaxByGrade.get(cls.gradeId) ?? 0
    const engHrs  = englishMaxByGrade.get(cls.gradeId) ?? 0
    const total   = directHours + mathHrs + engHrs

    const over  = total > totalSlots
    const tight = !over && total >= totalSlots * 0.85
    const status = over ? '❌ OVER' : tight ? '⚠  tight' : '✓'
    if (over)  anyOver  = true
    if (tight) anyTight = true

    console.log(
      h(label, 7) +
      h(String(directHours), 12) +
      h(mathHrs > 0 ? String(mathHrs) : '—', 7) +
      h(engHrs  > 0 ? String(engHrs)  : '—', 7) +
      h(String(total), 7) +
      h(`/ ${totalSlots}`, 6) +
      status
    )
  }

  console.log('─'.repeat(60))
  console.log('\n★ Math/English group hours = max(hoursPerWeek across all levels) per grade.')
  console.log('  All levels run simultaneously — students redistribute, one slot consumed.\n')

  if (anyOver) {
    console.log('❌  Some classes exceed the slot budget — violations will remain regardless of scheduler iterations.')
  } else if (anyTight) {
    console.log('⚠   Some classes are tight (≥85% full) — very little room for constraint satisfaction.')
  } else {
    console.log('✓  All classes fit within the slot budget.')
  }

  // --- Breakdown by subject for any OVER classes ---
  const overClasses = classes.filter(cls => {
    const d = lessons.filter(l => DIRECT_TYPES.includes(l.type) && l.classes.some(c => c.id === cls.id))
               .reduce((s, l) => s + l.hoursPerWeek, 0)
    const m = mathMaxByGrade.get(cls.gradeId) ?? 0
    const e = englishMaxByGrade.get(cls.gradeId) ?? 0
    return d + m + e > totalSlots
  })

  if (overClasses.length > 0) {
    console.log('\n── Subject breakdown for over-budget classes ──────────────────')
    for (const cls of overClasses) {
      const label = `${cls.grade.number}${cls.section}`
      console.log(`\n  ${label}:`)
      const myLessons = lessons.filter(l =>
        DIRECT_TYPES.includes(l.type) && l.classes.some(c => c.id === cls.id)
      )
      for (const l of myLessons) {
        console.log(`    ${l.subject.name.padEnd(22)} ${l.type.padEnd(14)} ${l.hoursPerWeek}h`)
      }
    }
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
