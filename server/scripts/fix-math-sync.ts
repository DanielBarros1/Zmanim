/**
 * fix-math-sync.ts — add LESSON_GRADE_SYNC for Grade 7 & 8 מתמטיקה.
 *
 * Grades 7 and 8 have REGULAR (not MATH_GROUP) math lessons — each class keeps
 * its own students and teacher — but the school requires both classes in a grade
 * to have math at the same slot.  This is the same constraint as חינוך; we use
 * the existing LESSON_GRADE_SYNC mechanism.
 *
 * Usage:
 *   cd server && npx tsx scripts/fix-math-sync.ts
 */

import 'dotenv/config'
import { prisma } from '../src/db'
import { RestrictionType, RestrictionTier } from '@zmanim/shared'

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`

async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Zmanim — Add LESSON_GRADE_SYNC for Grade 7 & 8 Math'))
  console.log(bold('══════════════════════════════════════════════════════\n'))

  const subject = await prisma.subject.findFirst({ where: { name: 'מתמטיקה' } })
  if (!subject) { console.error('Subject "מתמטיקה" not found'); return }

  const grades = await prisma.grade.findMany({
    where: { number: { in: [7, 8] } },
    include: { classes: true },
  })

  for (const grade of grades) {
    // Confirm there are REGULAR math lessons for this grade (not just MATH_GROUP)
    const regularMathLessons = await prisma.lesson.findMany({
      where: {
        subjectId: subject.id,
        type: 'REGULAR',
        classes: { some: { gradeId: grade.id } },
      },
      include: { teacher: true, classes: true },
    })

    if (regularMathLessons.length < 2) {
      console.log(yellow(`  Grade ${grade.number}: only ${regularMathLessons.length} regular math lesson(s) — skipping`))
      continue
    }

    const teachers = regularMathLessons.map(l => l.teacher.name).join(', ')
    console.log(`  Grade ${grade.number}: ${regularMathLessons.length} REGULAR math lessons (${teachers})`)

    // Check for existing restriction
    const existing = await prisma.restriction.findFirst({
      where: {
        type: RestrictionType.LESSON_GRADE_SYNC,
        subjectId: subject.id,
        gradeId: grade.id,
      },
    })

    if (existing) {
      console.log(dim(`    → LESSON_GRADE_SYNC already exists (id=${existing.id.slice(-8)}), skipping`))
      continue
    }

    await prisma.restriction.create({
      data: {
        type: RestrictionType.LESSON_GRADE_SYNC,
        tier: RestrictionTier.NON_NEGOTIABLE,
        subjectId: subject.id,
        gradeId: grade.id,
        params: {},
        note: `Grade ${grade.number} math must happen at the same slot for all classes`,
        isActive: true,
      },
    })
    console.log(green(`    → ✓ Created LESSON_GRADE_SYNC (NON_NEGOTIABLE)`))
  }

  console.log(bold('\n══════════════════════════════════════════════════════\n'))
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
