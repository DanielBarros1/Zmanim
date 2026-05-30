/**
 * audit-lessons.ts — lesson data breakdown
 *
 * Prints a per-grade, per-class breakdown of every lesson and its hours/week,
 * highlights duplicates and unusually high hour counts, and shows exactly
 * how many slots each class needs vs what's available.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/audit-lessons.ts
 */

import 'dotenv/config'
import { prisma } from '../src/db'

// ── Colour helpers ────────────────────────────────────────────────────────────
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`

function pad(s: string | number, n: number, right = false) {
  const str = String(s)
  return right ? str.padStart(n) : str.padEnd(n)
}

async function main() {
  // ── Load everything ─────────────────────────────────────────────────────────
  const [config, grades, lessons] = await Promise.all([
    prisma.schoolConfig.findFirst(),
    prisma.grade.findMany({ include: { classes: { orderBy: { section: 'asc' } } }, orderBy: { number: 'asc' } }),
    prisma.lesson.findMany({
      include: {
        subject:  true,
        teacher:  true,
        classes:  true,
        grade:    true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const slotsPerDay = config?.slotsPerDay ?? 4
  const workDays    = config?.workDays?.length ? config.workDays : ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY']
  const totalSlots  = slotsPerDay * workDays.length

  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Zmanim — Lesson Data Audit'))
  console.log(bold(`  ${slotsPerDay} slots/day × ${workDays.length} days = ${totalSlots} slots/class`))
  console.log(bold('══════════════════════════════════════════════════════\n'))

  // Overall totals
  let grandTotalLessons = 0
  let grandTotalHours   = 0

  for (const grade of grades) {
    const gradeLessons = lessons.filter(l =>
      l.gradeId === grade.id ||
      l.classes.some(c => c.gradeId === grade.id)
    )
    if (gradeLessons.length === 0) continue

    console.log(bold(cyan(`\n▶ Grade ${grade.number}`)))
    console.log(cyan('─'.repeat(54)))

    // ── Group lessons: MATH_GROUP and ENGLISH_GROUP ─────────────────────────
    const mathGroups    = gradeLessons.filter(l => l.type === 'MATH_GROUP')
    const englishGroups = gradeLessons.filter(l => l.type === 'ENGLISH_GROUP')

    if (mathGroups.length > 0 || englishGroups.length > 0) {
      console.log(bold('\n  Parallel groups (only MAX hours count per class):'))

      if (mathGroups.length > 0) {
        const maxMath = Math.max(...mathGroups.map(l => l.hoursPerWeek))
        console.log(`  Math groups  (${mathGroups.length} levels):`)
        for (const l of mathGroups) {
          const flag = l.hoursPerWeek === maxMath ? bold(' ← max') : ''
          console.log(`    ${pad(l.mathLevel ?? '?', 12)}  ${pad(l.teacher.name, 20)}  ${l.hoursPerWeek} hrs/wk${flag}`)
        }
        console.log(dim(`    → ${maxMath} slots consumed per class`))
      }

      if (englishGroups.length > 0) {
        const maxEnglish = Math.max(...englishGroups.map(l => l.hoursPerWeek))
        console.log(`  English groups (${englishGroups.length} levels):`)
        for (const l of englishGroups) {
          const flag = l.hoursPerWeek === maxEnglish ? bold(' ← max') : ''
          console.log(`    ${pad(l.englishLevel ?? '?', 12)}  ${pad(l.teacher.name, 20)}  ${l.hoursPerWeek} hrs/wk${flag}`)
        }
        console.log(dim(`    → ${maxEnglish} slots consumed per class`))
      }
    }

    // ── Per-class breakdown ─────────────────────────────────────────────────
    const maxMathHrs    = mathGroups.length    ? Math.max(...mathGroups.map(l => l.hoursPerWeek))    : 0
    const maxEnglishHrs = englishGroups.length ? Math.max(...englishGroups.map(l => l.hoursPerWeek)) : 0

    for (const cls of grade.classes) {
      const classLessons = gradeLessons.filter(l =>
        (l.type === 'REGULAR' || l.type === 'SHARED') &&
        l.classes.some(c => c.id === cls.id)
      )

      const regularHrs = classLessons.reduce((s, l) => s + l.hoursPerWeek, 0)
      const totalHrs   = regularHrs + maxMathHrs + maxEnglishHrs
      const status     = totalHrs > totalSlots
        ? red(`❌ ${totalHrs}/${totalSlots} INFEASIBLE (+${totalHrs - totalSlots} over)`)
        : totalHrs > totalSlots * 0.9
        ? yellow(`⚠  ${totalHrs}/${totalSlots} TIGHT`)
        : green(`✓  ${totalHrs}/${totalSlots}`)

      console.log(bold(`\n  Class ${cls.section}  —  ${status}`))

      if (classLessons.length === 0) {
        console.log(dim('    (no regular/shared lessons)'))
        continue
      }

      // Detect duplicate subjects (same subject appearing more than once)
      const subjectCount = new Map<string, number>()
      for (const l of classLessons) {
        subjectCount.set(l.subjectId, (subjectCount.get(l.subjectId) ?? 0) + 1)
      }

      // Print table
      console.log(dim(`    ${'Subject'.padEnd(24)} ${'Type'.padEnd(8)} ${'Teacher'.padEnd(22)} hrs/wk`))
      console.log(dim('    ' + '─'.repeat(66)))

      // Sort: duplicates first (so they're easy to spot), then alphabetical
      const sorted = [...classLessons].sort((a, b) => {
        const da = (subjectCount.get(a.subjectId) ?? 1) > 1 ? 0 : 1
        const db = (subjectCount.get(b.subjectId) ?? 1) > 1 ? 0 : 1
        if (da !== db) return da - db
        return (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '', 'he')
      })

      for (const l of sorted) {
        const subName  = l.subject?.name ?? '?'
        const isDup    = (subjectCount.get(l.subjectId) ?? 1) > 1
        const isShared = l.type === 'SHARED'
        const isHigh   = l.hoursPerWeek >= 6

        const dupFlag    = isDup  ? red(' ← DUPLICATE')     : ''
        const sharedFlag = isShared ? dim(' [shared]')       : ''
        const highFlag   = isHigh && !isDup ? yellow(' ← HIGH') : ''

        const line = `    ${pad(subName, 24)} ${pad(l.type, 8)} ${pad(l.teacher.name, 22)} ${l.hoursPerWeek}${dupFlag}${sharedFlag}${highFlag}`
        console.log(isDup ? red(line) : isHigh ? yellow(line) : line)
      }

      console.log(dim('    ' + '─'.repeat(66)))
      console.log(`    Regular+Shared total: ${bold(String(regularHrs))} hrs`)
      if (maxMathHrs > 0)    console.log(`    Math group (max):     ${bold(String(maxMathHrs))} hrs`)
      if (maxEnglishHrs > 0) console.log(`    English group (max):  ${bold(String(maxEnglishHrs))} hrs`)
      console.log(`    Grand total:          ${bold(String(totalHrs))} hrs  (${totalSlots} slots available)`)

      grandTotalLessons += classLessons.length
      grandTotalHours   += totalHrs
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Summary'))
  console.log(bold('══════════════════════════════════════════════════════'))

  const allClasses = grades.flatMap(g => g.classes)
  console.log(`  Total classes:          ${allClasses.length}`)
  console.log(`  Total lessons in DB:    ${lessons.length}  (REGULAR: ${lessons.filter(l=>l.type==='REGULAR').length}, SHARED: ${lessons.filter(l=>l.type==='SHARED').length}, MATH_GROUP: ${lessons.filter(l=>l.type==='MATH_GROUP').length}, ENGLISH_GROUP: ${lessons.filter(l=>l.type==='ENGLISH_GROUP').length})`)
  console.log(`  Slots/class available:  ${totalSlots}`)
  console.log()

  // Per-class feasibility summary
  for (const grade of grades) {
    const mathGroups    = lessons.filter(l => l.gradeId === grade.id && l.type === 'MATH_GROUP')
    const englishGroups = lessons.filter(l => l.gradeId === grade.id && l.type === 'ENGLISH_GROUP')
    const maxM = mathGroups.length    ? Math.max(...mathGroups.map(l => l.hoursPerWeek))    : 0
    const maxE = englishGroups.length ? Math.max(...englishGroups.map(l => l.hoursPerWeek)) : 0

    for (const cls of grade.classes) {
      const classLessons = lessons.filter(l =>
        (l.type === 'REGULAR' || l.type === 'SHARED') && l.classes.some(c => c.id === cls.id)
      )
      const total = classLessons.reduce((s,l) => s + l.hoursPerWeek, 0) + maxM + maxE
      const over  = total - totalSlots
      const line  = `  Grade ${grade.number} / ${cls.section}: ${String(total).padStart(3)} hrs needed`
      console.log(over > 0 ? red(`${line}  (+${over} over)`) : green(`${line}  ✓`))
    }
  }

  console.log(bold('\n══════════════════════════════════════════════════════\n'))
}

main()
  .catch(err => { console.error(red('\nFatal:'), err); process.exit(1) })
  .finally(() => prisma.$disconnect())
