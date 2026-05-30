/**
 * XLSX Importer — parses the school's exported lesson plan spreadsheet and
 * creates Subjects, Teachers, and Lessons in the database.
 *
 * Expected spreadsheet layout:
 *   Row 4 (index 3): Header row.  Column A = "מקצוע", columns B+ = class labels
 *                    e.g. "ז1", "ז2", "ח1", ..., "יב2"
 *   Rows 5+:         One subject per row.
 *                    Column A = subject name (Hebrew).
 *                    Other columns = lesson info for that class, format:
 *                      "<LAST NAME> <FIRST NAME> <HOURS_PER_WEEK>"
 *                    Multiple lessons per cell (for level groups) are
 *                    separated by newlines.
 *
 * Type detection per (subject, grade):
 *   - Multi-teacher, same list in all grade columns, math subject → MATH_GROUP
 *   - Multi-teacher, same list in all grade columns, English subject → ENGLISH_GROUP
 *   - Multi-teacher, same list in all grade columns, other subject → SHARED
 *     (one lesson per teacher, classIds = all classes in grade)
 *   - Single teacher per column (any pattern) → REGULAR (one lesson per class)
 *
 * Subjects are assigned colors cycling through a palette.
 * Math/English levels are assigned THREE_POINT / FOUR_POINT / FIVE_POINT in order.
 * Subjects/teachers that already exist in the DB are reused (matched by name).
 */

import * as XLSX from 'xlsx'
import { prisma } from '../db'
import { LessonType, MathLevel } from '@zmanim/shared'

// ─── Types ────────────────────────────────────────────────────

export interface ImportPreview {
  subjects: PreviewItem[]
  teachers: PreviewItem[]
  lessons:  PreviewLesson[]
  warnings: string[]
}

export interface PreviewItem {
  name: string
  /** Whether this record already exists in the DB */
  existing: boolean
}

export interface PreviewLesson {
  subject: string
  teacher: string
  type: LessonType
  classes: string[]    // human-readable class labels e.g. ["7A", "7B"]
  hoursPerWeek: number
  mathLevel?: MathLevel
  /** Whether a matching lesson already exists */
  existing: boolean
}

export interface ImportResult {
  subjectsCreated: number
  teachersCreated: number
  lessonsCreated: number
  lessonsSkipped: number
  warnings: string[]
}

// ─── Color palette (cycling) ──────────────────────────────────

const SUBJECT_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#F43F5E', '#A855F7', '#22C55E', '#EAB308',
  '#0EA5E9', '#D946EF', '#78716C', '#64748B', '#DC2626',
]

// ─── Grade parsing ────────────────────────────────────────────

// Hebrew grade prefixes in longest-first order (so "יא" is checked before "י")
const GRADE_PREFIXES: Array<[string, number]> = [
  ['יב', 12], ['יא', 11], ['י', 10], ['ט', 9], ['ח', 8], ['ז', 7],
]

interface GradeCol {
  colIndex: number
  gradeNumber: number
  section: string   // "A" or "B"
  label: string     // e.g. "7A"
}

function parseGradeLabel(raw: string): { gradeNumber: number; section: string } | null {
  const str = raw.trim()
  for (const [prefix, gradeNumber] of GRADE_PREFIXES) {
    if (str.startsWith(prefix)) {
      const rest = str.slice(prefix.length)
      const section = rest === '1' ? 'A' : rest === '2' ? 'B' : null
      if (!section) return null
      return { gradeNumber, section }
    }
  }
  return null
}

// ─── Lesson-line parsing ──────────────────────────────────────

interface RawLesson {
  lastName: string
  firstName: string
  hoursPerWeek: number
  fullName: string   // "Last First" for display / dedup
}

function parseCellLines(cellValue: unknown): RawLesson[] {
  if (!cellValue || typeof cellValue !== 'string') return []
  return cellValue
    .split(/\r?\n|\r/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(line => {
      const parts = line.split(/\s+/)
      if (parts.length < 3) return null
      const rawHours = parseInt(parts[parts.length - 1], 10)
      if (isNaN(rawHours) || rawHours <= 0) return null
      // The school's spreadsheet encodes hours as double the actual weekly slots
      // (e.g. 6 in the cell means 3 slots/week).  Halve on the way in.
      const hours = Math.max(1, Math.floor(rawHours / 2))
      const firstName = parts[parts.length - 2]
      const lastName = parts.slice(0, parts.length - 2).join(' ')
      return { lastName, firstName, hoursPerWeek: hours, fullName: `${lastName} ${firstName}` }
    })
    .filter((x): x is RawLesson => x !== null)
}

// ─── Subject type helpers ──────────────────────────────────────

const MATH_LEVEL_ORDER: MathLevel[] = [
  MathLevel.THREE_POINT,
  MathLevel.FOUR_POINT,
  MathLevel.FIVE_POINT,
]

function isMathSubject(name: string) { return name.includes('מתמטיקה') }
function isEnglishSubject(name: string) {
  // Exact "אנגלית" or starts with it (e.g. "אנגלית ") but NOT supplemental rows
  // like "אנגלית קפ' א" which are always empty anyway
  return name === 'אנגלית' || name.startsWith('אנגלית ')
}

// ─── Core parse: XLSX → structured rows ───────────────────────

interface ParsedCell {
  colIndex: number
  lessons: RawLesson[]
}

interface ParsedSubjectRow {
  subjectName: string
  cells: ParsedCell[]   // only columns that have content
}

function parseXlsx(buffer: Buffer): {
  rows: ParsedSubjectRow[]
  gradeCols: GradeCol[]
  warnings: string[]
} {
  const warnings: string[] = []
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')

  const cell = (r: number, c: number) =>
    ws[XLSX.utils.encode_cell({ r, c })]?.v as unknown

  // ── Find the header row (contains "מקצוע" in col A) ──────────
  let headerRow = -1
  for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
    const v = cell(r, 0)
    if (typeof v === 'string' && v.trim() === 'מקצוע') {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) {
    warnings.push('Could not find header row with "מקצוע" — make sure Row 4 is intact.')
    return { rows: [], gradeCols: [], warnings }
  }

  // ── Parse grade column headers ────────────────────────────────
  const gradeCols: GradeCol[] = []
  for (let c = 1; c <= range.e.c; c++) {
    const v = cell(headerRow, c)
    if (!v || typeof v !== 'string') continue
    const parsed = parseGradeLabel(v.trim())
    if (!parsed) continue
    gradeCols.push({
      colIndex: c,
      gradeNumber: parsed.gradeNumber,
      section: parsed.section,
      label: `${parsed.gradeNumber}${parsed.section}`,
    })
  }

  if (gradeCols.length === 0) {
    warnings.push('No valid grade column headers found.')
    return { rows: [], gradeCols: [], warnings }
  }

  // ── Parse subject rows ────────────────────────────────────────
  const colSet = new Set(gradeCols.map(g => g.colIndex))
  const rows: ParsedSubjectRow[] = []

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const subjectRaw = cell(r, 0)
    if (!subjectRaw || typeof subjectRaw !== 'string') continue
    const subjectName = subjectRaw.trim()
    if (!subjectName || subjectName === 'xxx') continue

    const cells: ParsedCell[] = []
    for (const gc of gradeCols) {
      const v = cell(r, gc.colIndex)
      const lessons = parseCellLines(v as string)
      if (lessons.length > 0) {
        cells.push({ colIndex: gc.colIndex, lessons })
      }
    }

    // Skip subjects with no lesson data at all
    if (cells.length === 0) continue

    rows.push({ subjectName, cells })
  }

  return { rows, gradeCols, warnings }
}

// ─── Build lesson specs from parsed rows ──────────────────────

interface LessonSpec {
  subjectName: string
  teacherFullName: string
  teacherLastName: string
  teacherFirstName: string
  type: LessonType
  gradeCols: GradeCol[]     // which class columns this lesson covers
  hoursPerWeek: number
  mathLevel?: MathLevel
}

function buildLessonSpecs(
  rows: ParsedSubjectRow[],
  gradeCols: GradeCol[],
): { specs: LessonSpec[]; warnings: string[] } {
  const warnings: string[] = []
  const specs: LessonSpec[] = []

  // Build a map: gradeNumber → GradeCols (sorted A→B)
  const gradeColsMap = new Map<number, GradeCol[]>()
  for (const gc of gradeCols) {
    if (!gradeColsMap.has(gc.gradeNumber)) gradeColsMap.set(gc.gradeNumber, [])
    gradeColsMap.get(gc.gradeNumber)!.push(gc)
  }

  for (const row of rows) {
    const { subjectName, cells } = row
    const isMath = isMathSubject(subjectName)
    const isEnglish = isEnglishSubject(subjectName)

    // Group cells by grade
    const cellByCol = new Map(cells.map(c => [c.colIndex, c]))

    for (const [gradeNumber, gcList] of gradeColsMap) {
      const gradeCells = gcList
        .map(gc => ({ gc, cell: cellByCol.get(gc.colIndex) }))
        .filter(x => x.cell !== undefined) as { gc: GradeCol; cell: ParsedCell }[]

      if (gradeCells.length === 0) continue

      // Determine if all grade columns agree on the same lesson list
      const allLists = gradeCells.map(x => x.cell.lessons)
      const firstList = allLists[0]
      const allMatch =
        allLists.length > 1 &&
        allLists.every(list =>
          list.length === firstList.length &&
          list.every((l, i) => l.fullName === firstList[i].fullName && l.hoursPerWeek === firstList[i].hoursPerWeek),
        )

      const isGroupCandidate = firstList.length > 1 && (allMatch || gradeCells.length === 1)

      if (isGroupCandidate && (isMath || isEnglish)) {
        // MATH_GROUP / ENGLISH_GROUP
        const type = isMath ? LessonType.MATH_GROUP : LessonType.ENGLISH_GROUP
        const levels = MATH_LEVEL_ORDER

        firstList.forEach((lesson, idx) => {
          if (idx >= levels.length) {
            warnings.push(
              `${subjectName} Grade ${gradeNumber}: more than 3 groups found ` +
              `(teacher "${lesson.fullName}" at index ${idx + 1} skipped — only 3 levels supported).`,
            )
            return
          }
          specs.push({
            subjectName,
            teacherFullName: lesson.fullName,
            teacherLastName: lesson.lastName,
            teacherFirstName: lesson.firstName,
            type,
            gradeCols: gcList,   // all class columns in this grade
            hoursPerWeek: lesson.hoursPerWeek,
            mathLevel: levels[idx],
          })
        })
      } else if (isGroupCandidate && !isMath && !isEnglish) {
        // Non-math/English groups (e.g. Studio elective tracks) → SHARED per teacher
        firstList.forEach(lesson => {
          specs.push({
            subjectName,
            teacherFullName: lesson.fullName,
            teacherLastName: lesson.lastName,
            teacherFirstName: lesson.firstName,
            type: LessonType.SHARED,
            gradeCols: gcList,
            hoursPerWeek: lesson.hoursPerWeek,
          })
        })
      } else {
        // REGULAR — one lesson per class column per teacher
        for (const { gc, cell } of gradeCells) {
          for (const lesson of cell.lessons) {
            specs.push({
              subjectName,
              teacherFullName: lesson.fullName,
              teacherLastName: lesson.lastName,
              teacherFirstName: lesson.firstName,
              type: LessonType.REGULAR,
              gradeCols: [gc],
              hoursPerWeek: lesson.hoursPerWeek,
            })
          }
        }
      }
    }
  }

  return { specs, warnings }
}

// ─── Public: preview (no DB writes) ──────────────────────────

export async function previewImport(buffer: Buffer): Promise<ImportPreview> {
  const { rows, gradeCols, warnings } = parseXlsx(buffer)
  const { specs, warnings: specWarnings } = buildLessonSpecs(rows, gradeCols)

  // Collect unique subjects and teachers
  const subjectNames = [...new Set(specs.map(s => s.subjectName))]
  const teacherNames = [...new Set(specs.map(s => s.teacherFullName))]

  // Check which already exist
  const [existingSubjects, existingTeachers] = await Promise.all([
    prisma.subject.findMany({ where: { name: { in: subjectNames } }, select: { name: true } }),
    prisma.teacher.findMany({ where: { name: { in: teacherNames } }, select: { name: true } }),
  ])
  const existingSubjectSet = new Set(existingSubjects.map(s => s.name))
  const existingTeacherSet = new Set(existingTeachers.map(t => t.name))

  // Build preview lessons
  const gradeColMap = new Map(gradeCols.map(g => [g.colIndex, g]))
  const previewLessons: PreviewLesson[] = specs.map(spec => ({
    subject: spec.subjectName,
    teacher: spec.teacherFullName,
    type: spec.type,
    classes: spec.gradeCols.map(g => g.label),
    hoursPerWeek: spec.hoursPerWeek,
    mathLevel: spec.mathLevel,
    existing: false,   // computed cheaply; full check happens on execute
  }))

  return {
    subjects: subjectNames.map(n => ({ name: n, existing: existingSubjectSet.has(n) })),
    teachers: teacherNames.map(n => ({ name: n, existing: existingTeacherSet.has(n) })),
    lessons: previewLessons,
    warnings: [...warnings, ...specWarnings],
  }
}

// ─── Public: execute (writes to DB) ──────────────────────────

export async function executeImport(buffer: Buffer): Promise<ImportResult> {
  const { rows, gradeCols, warnings } = parseXlsx(buffer)
  const { specs, warnings: specWarnings } = buildLessonSpecs(rows, gradeCols)
  const allWarnings = [...warnings, ...specWarnings]

  // ── 1. Load existing grades + classes ─────────────────────────
  const [dbGrades, dbClasses] = await Promise.all([
    prisma.grade.findMany(),
    prisma.class.findMany(),
  ])

  // Map gradeNumber → Grade record
  const gradeByNumber = new Map(dbGrades.map(g => [g.number, g]))

  // Map (gradeId, section) → Class record
  const classByGradeSection = new Map(
    dbClasses.map(c => [`${c.gradeId}:${c.section}`, c]),
  )

  // Map gradeCol → Class id
  const classIdByGradeCol = new Map<GradeCol, string>()
  for (const gc of gradeCols) {
    const grade = gradeByNumber.get(gc.gradeNumber)
    if (!grade) {
      allWarnings.push(`Grade ${gc.gradeNumber} not found in DB — columns for it will be skipped.`)
      continue
    }
    const cls = classByGradeSection.get(`${grade.id}:${gc.section}`)
    if (!cls) {
      allWarnings.push(`Class ${gc.label} not found in DB — its lessons will be skipped.`)
      continue
    }
    classIdByGradeCol.set(gc, cls.id)
  }

  // ── 2. Find or create subjects ─────────────────────────────────
  const subjectNames = [...new Set(specs.map(s => s.subjectName))]
  const existingSubjects = await prisma.subject.findMany({
    where: { name: { in: subjectNames } },
  })
  const subjectMap = new Map(existingSubjects.map(s => [s.name, s]))

  let subjectsCreated = 0
  let colorIdx = existingSubjects.length  // continue palette from where we left off

  for (const name of subjectNames) {
    if (subjectMap.has(name)) continue
    const color = SUBJECT_COLORS[colorIdx % SUBJECT_COLORS.length]
    colorIdx++
    const created = await prisma.subject.create({
      data: { name, color, isArts: false },
    })
    subjectMap.set(name, created)
    subjectsCreated++
  }

  // ── 3. Find or create teachers and connect their subjects ─────
  const teacherFullNames = [...new Set(specs.map(s => s.teacherFullName))]
  const existingTeachers = await prisma.teacher.findMany({
    where: { name: { in: teacherFullNames } },
  })
  const teacherMap = new Map(existingTeachers.map(t => [t.name, t]))

  // Build teacher → subject IDs mapping from specs (subjects are already resolved above)
  const teacherSubjectsFromSpecs = new Map<string, Set<string>>()
  for (const spec of specs) {
    const subject = subjectMap.get(spec.subjectName)
    if (!subject) continue
    if (!teacherSubjectsFromSpecs.has(spec.teacherFullName)) {
      teacherSubjectsFromSpecs.set(spec.teacherFullName, new Set())
    }
    teacherSubjectsFromSpecs.get(spec.teacherFullName)!.add(subject.id)
  }

  let teachersCreated = 0
  for (const fullName of teacherFullNames) {
    const subjectIds = teacherSubjectsFromSpecs.get(fullName) ?? new Set<string>()
    const subjectConnect = [...subjectIds].map(id => ({ id }))

    if (teacherMap.has(fullName)) {
      // Existing teacher — connect new subjects (connect is idempotent for M:N)
      if (subjectConnect.length > 0) {
        await prisma.teacher.update({
          where: { id: teacherMap.get(fullName)!.id },
          data: { subjects: { connect: subjectConnect } },
        })
      }
    } else {
      const created = await prisma.teacher.create({
        data: {
          name: fullName,
          ...(subjectConnect.length > 0 && { subjects: { connect: subjectConnect } }),
        },
      })
      teacherMap.set(fullName, created)
      teachersCreated++
    }
  }

  // ── 4. Find or create lessons ──────────────────────────────────
  // Load existing lessons with their class relations for deduplication
  const existingLessons = await prisma.lesson.findMany({
    include: { classes: true },
  })

  // Dedup key: subjectId:teacherId:classIds(sorted):type
  const existingLessonKeys = new Set(
    existingLessons.map(l =>
      `${l.subjectId}:${l.teacherId}:${l.type}:${l.classes.map(c => c.id).sort().join(',')}`,
    ),
  )

  let lessonsCreated = 0
  let lessonsSkipped = 0

  for (const spec of specs) {
    const subject = subjectMap.get(spec.subjectName)
    const teacher = teacherMap.get(spec.teacherFullName)
    if (!subject || !teacher) {
      allWarnings.push(`Skipping lesson — subject "${spec.subjectName}" or teacher "${spec.teacherFullName}" could not be resolved.`)
      lessonsSkipped++
      continue
    }

    // Resolve class IDs for this spec
    const classIds: string[] = []
    for (const gc of spec.gradeCols) {
      const cid = classIdByGradeCol.get(gc)
      if (!cid) {
        // Grade/class doesn't exist in DB — warn and skip
        allWarnings.push(`Skipping ${spec.subjectName} for class ${gc.label} — class not found in DB.`)
      } else {
        classIds.push(cid)
      }
    }
    if (classIds.length === 0) {
      lessonsSkipped++
      continue
    }

    // For group lessons, gradeId comes from the grade of the first class column
    const gradeId = spec.gradeCols.length > 0
      ? gradeByNumber.get(spec.gradeCols[0].gradeNumber)?.id ?? null
      : null

    const dupKey = `${subject.id}:${teacher.id}:${spec.type}:${classIds.slice().sort().join(',')}`
    if (existingLessonKeys.has(dupKey)) {
      lessonsSkipped++
      continue
    }

    await prisma.lesson.create({
      data: {
        subjectId: subject.id,
        teacherId: teacher.id,
        type: spec.type,
        hoursPerWeek: spec.hoursPerWeek,
        gradeId: (spec.type === LessonType.MATH_GROUP || spec.type === LessonType.ENGLISH_GROUP || spec.type === LessonType.SHARED)
          ? gradeId
          : null,
        mathLevel:    spec.type === LessonType.MATH_GROUP    ? (spec.mathLevel ?? null) : null,
        englishLevel: spec.type === LessonType.ENGLISH_GROUP ? (spec.mathLevel ?? null) : null,
        classes: { connect: classIds.map(id => ({ id })) },
      },
    })

    existingLessonKeys.add(dupKey)   // prevent within-batch duplicates
    lessonsCreated++
  }

  // ── 5. Backfill teacher-subject assignments for ALL lessons ───
  // Ensures pre-existing teachers also get their subjects connected,
  // not just the ones touched by this import batch.
  const allLessons = await prisma.lesson.findMany({ select: { teacherId: true, subjectId: true } })
  const teacherSubjectsAll = new Map<string, Set<string>>()
  for (const l of allLessons) {
    if (!l.teacherId) continue  // PARALLEL/MULTI_TEACHER have no primary teacher
    if (!teacherSubjectsAll.has(l.teacherId)) teacherSubjectsAll.set(l.teacherId, new Set())
    teacherSubjectsAll.get(l.teacherId)!.add(l.subjectId)
  }
  for (const [teacherId, subjectIds] of teacherSubjectsAll) {
    await prisma.teacher.update({
      where: { id: teacherId },
      data: { subjects: { connect: [...subjectIds].map(id => ({ id })) } },
    })
  }

  return {
    subjectsCreated,
    teachersCreated,
    lessonsCreated,
    lessonsSkipped,
    warnings: allWarnings,
  }
}
