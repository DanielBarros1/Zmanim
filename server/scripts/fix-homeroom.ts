/**
 * fix-homeroom.ts — one-time data fix for חינוך (homeroom) lessons.
 *
 * Problem: Grade 12 has two SHARED חינוך lessons that are both linked to G12A only.
 *          G12B therefore has no חינוך at all.
 *          All other grades have חינוך correctly as REGULAR (one per class).
 *
 * What this script does:
 *   1. Fix Grade 12: convert both SHARED חינוך lessons to REGULAR.
 *      Teacher 1 (שאכטר אורי) → G12A  (class link already correct, just change type)
 *      Teacher 2 (שיין גילי)  → G12B  (remove G12A, connect G12B, change type)
 *   2. Add LESSON_GRADE_SYNC (NON_NEGOTIABLE) restrictions for every grade that has
 *      חינוך lessons, so the scheduler will synchronise them in Phase A'.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/fix-homeroom.ts
 */

import 'dotenv/config'
import { prisma } from '../src/db'
import { RestrictionType, RestrictionTier } from '@zmanim/shared'

const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`

async function main() {
  console.log(bold('\n══════════════════════════════════════════════════════'))
  console.log(bold('  Zmanim — Fix חינוך (Homeroom) lessons'))
  console.log(bold('══════════════════════════════════════════════════════\n'))

  // ── Load all grades and their classes ────────────────────────────────────────
  const grades = await prisma.grade.findMany({
    include: { classes: { orderBy: { section: 'asc' } } },
    orderBy: { number: 'asc' },
  })

  // ── Load חינוך subject ────────────────────────────────────────────────────────
  const subject = await prisma.subject.findFirst({ where: { name: 'חינוך' } })
  if (!subject) {
    console.log(red('  ✗ Subject "חינוך" not found in DB'))
    return
  }
  console.log(`  Subject "חינוך" id: ${subject.id.slice(-8)}\n`)

  // ── Step 1: Fix Grade 12 SHARED → REGULAR ─────────────────────────────────
  console.log(bold('── Step 1: Fix Grade 12 חינוך (SHARED → REGULAR) ──────'))

  const grade12 = grades.find(g => g.number === 12)
  if (!grade12) {
    console.log(yellow('  Grade 12 not found, skipping.'))
  } else {
    const classA = grade12.classes.find(c => c.section === 'A')
    const classB = grade12.classes.find(c => c.section === 'B')

    if (!classA || !classB) {
      console.log(yellow('  Grade 12 missing class A or B, skipping.'))
    } else {
      // Find all SHARED חינוך lessons (any classes composition)
      const sharedLessons = await prisma.lesson.findMany({
        where: { subjectId: subject.id, type: 'SHARED' },
        include: { teacher: true, classes: true },
        orderBy: { createdAt: 'asc' },
      })

      if (sharedLessons.length === 0) {
        console.log(dim('  No SHARED חינוך lessons found — already fixed.'))
      } else {
        console.log(`  Found ${sharedLessons.length} SHARED חינוך lesson(s):`)
        for (const l of sharedLessons) {
          const cls = l.classes.map(c => c.section).join(', ')
          console.log(`    [${l.id.slice(-8)}] teacher=${l.teacher.name}  classes=[${cls}]`)
        }

        // Assign: first lesson → Class A, second → Class B, rest → Class A
        const assignments: Array<{ lesson: typeof sharedLessons[0]; targetClassId: string; targetSection: string }> = []
        for (let i = 0; i < sharedLessons.length; i++) {
          const targetClass = i === 0 ? classA : classB
          assignments.push({ lesson: sharedLessons[i], targetClassId: targetClass.id, targetSection: targetClass.section })
        }

        for (const { lesson, targetClassId, targetSection } of assignments) {
          console.log(`  → [${lesson.id.slice(-8)}] ${lesson.teacher.name} => G12${targetSection} (REGULAR)`)
          await prisma.lesson.update({
            where: { id: lesson.id },
            data: {
              type: 'REGULAR',
              gradeId: null,   // REGULAR lessons don't use gradeId
              classes: {
                set: [{ id: targetClassId }],  // Replace whatever classes were there
              },
            },
          })
        }

        console.log(green('  ✓ SHARED חינוך lessons converted to REGULAR\n'))
      }
    }
  }

  // ── Step 2: Add LESSON_GRADE_SYNC restrictions ──────────────────────────────
  console.log(bold('── Step 2: Add LESSON_GRADE_SYNC restrictions ──────────'))

  // Re-load lessons after step 1
  const allHomeroomLessons = await prisma.lesson.findMany({
    where: { subjectId: subject.id },
    include: { classes: { include: { grade: true } } },
  })

  // Group by grade
  const lessonsByGrade = new Map<string, typeof allHomeroomLessons>()
  for (const lesson of allHomeroomLessons) {
    for (const cls of lesson.classes) {
      const gid = cls.gradeId
      if (!lessonsByGrade.has(gid)) lessonsByGrade.set(gid, [])
      lessonsByGrade.get(gid)!.push(lesson)
    }
  }

  // Remove duplicate lesson references per grade
  for (const [gid, ls] of lessonsByGrade) {
    lessonsByGrade.set(gid, [...new Map(ls.map(l => [l.id, l])).values()])
  }

  // Check for existing LESSON_GRADE_SYNC restrictions for this subject
  const existingRestrictions = await prisma.restriction.findMany({
    where: { type: RestrictionType.LESSON_GRADE_SYNC, subjectId: subject.id },
  })
  const existingGradeIds = new Set(existingRestrictions.map(r => r.gradeId).filter(Boolean))

  let created = 0
  let skipped = 0

  for (const [gradeId, lessons] of lessonsByGrade) {
    const gradeNum = lessons[0]?.classes[0]?.grade?.number ?? '?'

    if (lessons.length < 2) {
      console.log(dim(`  Grade ${gradeNum}: only ${lessons.length} חינוך lesson — no sync needed`))
      skipped++
      continue
    }

    if (existingGradeIds.has(gradeId)) {
      console.log(dim(`  Grade ${gradeNum}: LESSON_GRADE_SYNC already exists — skipping`))
      skipped++
      continue
    }

    await prisma.restriction.create({
      data: {
        type: RestrictionType.LESSON_GRADE_SYNC,
        tier: RestrictionTier.NON_NEGOTIABLE,
        subjectId: subject.id,
        gradeId,
        params: {},
        note: 'חינוך must happen at the same slot for all classes in the grade',
        isActive: true,
      },
    })
    console.log(green(`  Grade ${gradeNum}: ✓ Created LESSON_GRADE_SYNC (NON_NEGOTIABLE)`))
    created++
  }

  console.log(`\n  Created: ${created}  Skipped: ${skipped}\n`)
  console.log(bold('══════════════════════════════════════════════════════\n'))
}

main()
  .catch(err => { console.error(red('\nFatal:'), err); process.exit(1) })
  .finally(() => prisma.$disconnect())
