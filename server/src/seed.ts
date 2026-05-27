/**
 * Database seed
 *
 * Run with: npm run db:seed (from server/)
 *
 * Creates:
 *  - Grades 7–12, each with classes A and B
 *  - Default school config
 *  - Default restrictions (B1 for grades 7-10, B2 for grades 11-12,
 *    B3 and B4 for all classes)
 *
 * Safe to run multiple times — uses upsert/findOrCreate patterns.
 */

import { prisma } from './db'

async function main() {
  console.log('Seeding database...')

  // ── School Config ─────────────────────────────────────────────
  const existingConfig = await prisma.schoolConfig.findFirst()
  if (!existingConfig) {
    await prisma.schoolConfig.create({
      data: {
        dayStartTime: '08:00',
        lessonDuration: 75,
        slotsPerDay: 4,
        recesses: [
          { afterSlot: 1, durationMinutes: 15 },
          { afterSlot: 2, durationMinutes: 20 },
          { afterSlot: 3, durationMinutes: 10 },
        ],
        workDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'],
      },
    })
    console.log('  ✓ Default school config created')
  }

  // ── Grades + Classes ──────────────────────────────────────────
  const gradeNumbers = [7, 8, 9, 10, 11, 12]
  const grades: Record<number, { id: string; classes: Record<string, string> }> = {}

  for (const num of gradeNumbers) {
    const grade = await prisma.grade.upsert({
      where: { number: num },
      update: {},
      create: { number: num },
    })

    grades[num] = { id: grade.id, classes: {} }

    for (const section of ['A', 'B']) {
      const cls = await prisma.class.upsert({
        where: { gradeId_section: { gradeId: grade.id, section } },
        update: {},
        create: { gradeId: grade.id, section },
      })
      grades[num].classes[section] = cls.id
    }
  }
  console.log('  ✓ Grades 7–12 and classes A/B seeded')

  // ── Default restrictions ───────────────────────────────────────
  // B1: No mid-day windows for grades 7–10 (applied per-class, Non-negotiable)
  for (const num of [7, 8, 9, 10]) {
    for (const [, classId] of Object.entries(grades[num].classes)) {
      await prisma.restriction.upsert({
        where: {
          // Use a unique compound that doesn't exist in schema — use findFirst instead
          id: `seed-b1-${classId}`, // won't match but upsert needs a where
        },
        update: {},
        create: {
          type: 'CLASS_NO_WINDOW',
          tier: 'NON_NEGOTIABLE',
          classId,
          params: {},
          note: 'Seeded default — grades 7–10 must have no mid-day windows',
        },
      }).catch(async () => {
        // If upsert by id fails (no existing record), create fresh
        const exists = await prisma.restriction.findFirst({
          where: { type: 'CLASS_NO_WINDOW', classId },
        })
        if (!exists) {
          await prisma.restriction.create({
            data: {
              type: 'CLASS_NO_WINDOW',
              tier: 'NON_NEGOTIABLE',
              classId,
              params: {},
              note: 'Seeded default — grades 7–10 must have no mid-day windows',
            },
          })
        }
      })
    }
  }

  // B2: Minimize windows for grades 11–12 (Preferred)
  for (const num of [11, 12]) {
    for (const [, classId] of Object.entries(grades[num].classes)) {
      const exists = await prisma.restriction.findFirst({
        where: { type: 'CLASS_MINIMIZE_WINDOWS', classId },
      })
      if (!exists) {
        await prisma.restriction.create({
          data: {
            type: 'CLASS_MINIMIZE_WINDOWS',
            tier: 'PREFERRED',
            classId,
            params: {},
            note: 'Seeded default — grades 11–12 windows should be minimized',
          },
        })
      }
    }
  }

  // B3: No same subject twice per day — all classes, Important
  // B4: Arts balance — all classes, Important
  for (const num of gradeNumbers) {
    for (const [, classId] of Object.entries(grades[num].classes)) {
      for (const [type, note] of [
        ['CLASS_NO_SUBJECT_TWICE_PER_DAY', 'Seeded default — no subject twice per day'],
        ['CLASS_ARTS_BALANCE', 'Seeded default — arts/non-arts balance per day'],
      ]) {
        const exists = await prisma.restriction.findFirst({ where: { type: type as any, classId } })
        if (!exists) {
          await prisma.restriction.create({
            data: {
              type: type as any,
              tier: 'IMPORTANT',
              classId,
              params: {},
              note,
            },
          })
        }
      }
    }
  }

  console.log('  ✓ Default restrictions seeded')
  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
