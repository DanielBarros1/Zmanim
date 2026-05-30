/**
 * ImportPage — XLSX lesson-plan importer.
 *
 * Two-step flow:
 *   Step 1 — Upload: drag-drop or click to pick an .xlsx file.
 *                    "Preview" button parses the file server-side (no DB writes).
 *   Step 2 — Review: shows what will be created (subjects, teachers, lessons)
 *                    vs what already exists.  Any warnings are shown here.
 *                    "Confirm Import" writes everything to the DB.
 *   Step 3 — Result: summary of what was created.
 *
 * Expected XLSX format (Ankori High School export):
 *   Row 4: "מקצוע" | "ז1" | "ז2" | "ח1" | ...
 *   Rows 5+: subject name | per-class lesson info
 *   Lesson cell format: "<LAST> <FIRST> <HOURS>" (newline-separated for groups)
 */

import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { usePreviewImport, useExecuteImport } from '../api/import'
import type { ImportPreview, ImportResult } from '../api/import'
import { LessonType, MATH_LEVEL_LABEL } from '@zmanim/shared'
import type { MathLevel } from '@zmanim/shared'

type Step = 'upload' | 'preview' | 'done'

const TYPE_LABEL: Record<LessonType, string> = {
  [LessonType.REGULAR]:       'Regular',
  [LessonType.SHARED]:        'Shared',
  [LessonType.MATH_GROUP]:    'Math Group',
  [LessonType.ENGLISH_GROUP]: 'English Group',
}

const TYPE_COLOR: Record<LessonType, string> = {
  [LessonType.REGULAR]:       'var(--text-3)',
  [LessonType.SHARED]:        'var(--accent)',
  [LessonType.MATH_GROUP]:    '#6D28D9',
  [LessonType.ENGLISH_GROUP]: '#0369A1',
}

export function ImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const previewMutation = usePreviewImport()
  const executeMutation = useExecuteImport()

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File selection ────────────────────────────────────────────

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setPreview(null)
    setStep('upload')
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ── Step 1 → 2: Preview ───────────────────────────────────────

  const handlePreview = async () => {
    if (!file) return
    const data = await previewMutation.mutateAsync(file)
    setPreview(data)
    setStep('preview')
  }

  // ── Step 2 → 3: Execute ───────────────────────────────────────

  const handleExecute = async () => {
    if (!file) return
    const data = await executeMutation.mutateAsync(file)
    setResult(data)
    setStep('done')
    // Invalidate all data queries so the lessons/teachers/subjects pages refresh
    queryClient.invalidateQueries()
  }

  // ── Render helpers ────────────────────────────────────────────

  const topbarActions = (
    <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
      ← Home
    </Button>
  )

  // ─────────────────────────────────────────────────────────────
  return (
    <AppShell title="Import from XLSX" actions={topbarActions}>
      <div className="flex flex-col items-center px-6 py-8 gap-6 w-full max-w-4xl mx-auto">

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-3 text-[12px] font-medium">
          {(['upload', 'preview', 'done'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              {i > 0 && <div className="w-8 h-px" style={{ background: 'var(--border)' }} />}
              <span
                className="px-2.5 py-1 rounded-full"
                style={{
                  background: step === s ? 'var(--accent)' : 'var(--surface-2)',
                  color: step === s ? '#fff' : 'var(--text-3)',
                }}
              >
                {i + 1}. {s === 'upload' ? 'Upload' : s === 'preview' ? 'Review' : 'Done'}
              </span>
            </div>
          ))}
        </div>

        {/* ══ STEP 1: Upload ══════════════════════════════════════ */}
        {(step === 'upload' || (step === 'preview' && !preview)) && (
          <div className="w-full space-y-5">
            <div
              className="w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-14 cursor-pointer transition-colors"
              style={{
                borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                background: dragOver ? 'var(--accent-bg)' : 'var(--surface)',
              }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="text-4xl">📊</span>
              <p className="text-[14px] font-medium" style={{ color: 'var(--text-1)' }}>
                {file ? file.name : 'Drop your .xlsx file here'}
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB — click to change`
                  : 'or click to browse'}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={onFileInput}
              />
            </div>

            {/* Format reminder */}
            <div
              className="rounded-lg p-4 text-[12px] space-y-1"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Expected format:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Row 4: <span className="font-mono">מקצוע | ז1 | ז2 | ח1 | ח2 | ...</span></li>
                <li>Each data cell: <span className="font-mono">LAST FIRST HOURS</span> (e.g. <span className="font-mono">כהן דן 3</span>)</li>
                <li>Multiple groups in one cell: separate lines (e.g. math/English level groups)</li>
                <li>Empty rows and "xxx" rows are ignored</li>
              </ul>
            </div>

            {previewMutation.error && (
              <p className="text-[12px] text-red-600">{previewMutation.error.message}</p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handlePreview}
                disabled={!file}
                loading={previewMutation.isPending}
              >
                Preview Import →
              </Button>
            </div>
          </div>
        )}

        {/* ══ STEP 2: Preview ═════════════════════════════════════ */}
        {step === 'preview' && preview && (
          <div className="w-full space-y-6">

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div
                className="rounded-lg p-4 space-y-1"
                style={{ background: '#FFFBEB', border: '1px solid #FCD34D' }}
              >
                <p className="text-[12px] font-semibold text-amber-800">
                  ⚠ {preview.warnings.length} warning{preview.warnings.length !== 1 ? 's' : ''}
                </p>
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-amber-700">{w}</p>
                ))}
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: 'Subjects',
                  items: preview.subjects,
                  emoji: '📚',
                },
                {
                  label: 'Teachers',
                  items: preview.teachers,
                  emoji: '👤',
                },
                {
                  label: 'Lessons',
                  items: preview.lessons.map(l => ({ name: `${l.subject} — ${l.teacher}`, existing: l.existing })),
                  emoji: '📅',
                },
              ].map(({ label, items, emoji }) => {
                const newCount = items.filter(i => !i.existing).length
                const existCount = items.filter(i => i.existing).length
                return (
                  <div
                    key={label}
                    className="rounded-xl p-4 space-y-1"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <p className="text-2xl">{emoji}</p>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {label}
                    </p>
                    <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                      <span className="font-medium text-green-600">+{newCount} new</span>
                      {existCount > 0 && (
                        <span className="ml-1 text-[var(--text-3)]">/ {existCount} existing (skipped)</span>
                      )}
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Subjects list */}
            <Section title="Subjects" count={preview.subjects.length}>
              <div className="flex flex-wrap gap-2">
                {preview.subjects.map(s => (
                  <span
                    key={s.name}
                    className="text-[11px] px-2 py-1 rounded-full hebrew"
                    style={{
                      background: s.existing ? 'var(--surface-2)' : 'var(--accent-bg)',
                      color: s.existing ? 'var(--text-3)' : 'var(--accent)',
                      border: `1px solid ${s.existing ? 'var(--border)' : 'var(--accent)'}`,
                    }}
                  >
                    {s.existing ? '✓ ' : '+ '}{s.name}
                  </span>
                ))}
              </div>
            </Section>

            {/* Teachers list */}
            <Section title="Teachers" count={preview.teachers.length}>
              <div className="flex flex-wrap gap-2">
                {preview.teachers.map(t => (
                  <span
                    key={t.name}
                    className="text-[11px] px-2 py-1 rounded-full hebrew"
                    style={{
                      background: t.existing ? 'var(--surface-2)' : 'var(--accent-bg)',
                      color: t.existing ? 'var(--text-3)' : 'var(--accent)',
                      border: `1px solid ${t.existing ? 'var(--border)' : 'var(--accent)'}`,
                    }}
                  >
                    {t.existing ? '✓ ' : '+ '}{t.name}
                  </span>
                ))}
              </div>
            </Section>

            {/* Lessons table */}
            <Section title="Lessons" count={preview.lessons.length}>
              <div
                className="rounded-lg overflow-hidden border"
                style={{ borderColor: 'var(--border)' }}
              >
                <div
                  className="grid text-[10px] font-bold uppercase tracking-wider px-3 py-2"
                  style={{
                    gridTemplateColumns: '2fr 2fr 1fr 2fr 60px',
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                  }}
                >
                  <span>Subject</span>
                  <span>Teacher</span>
                  <span>Type</span>
                  <span>Classes</span>
                  <span>h/wk</span>
                </div>
                <div className="divide-y max-h-[360px] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {preview.lessons.map((l, i) => (
                    <div
                      key={i}
                      className="grid items-center px-3 py-1.5 text-[11px]"
                      style={{
                        gridTemplateColumns: '2fr 2fr 1fr 2fr 60px',
                        background: l.existing ? 'var(--surface-2)' : 'var(--surface)',
                        color: l.existing ? 'var(--text-3)' : 'var(--text-1)',
                        opacity: l.existing ? 0.6 : 1,
                      }}
                    >
                      <span className="hebrew truncate">{l.subject}</span>
                      <span className="hebrew truncate">{l.teacher}</span>
                      <span>
                        <TypeBadge type={l.type} mathLevel={l.mathLevel} />
                      </span>
                      <span className="text-[10px] text-[var(--text-2)]">
                        {l.classes.join(', ')}
                      </span>
                      <span style={{ color: 'var(--text-2)' }}>{l.hoursPerWeek}h</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {executeMutation.error && (
              <p className="text-[12px] text-red-600">{executeMutation.error.message}</p>
            )}

            <div className="flex justify-between">
              <Button
                variant="secondary"
                onClick={() => { setStep('upload'); setPreview(null) }}
              >
                ← Back
              </Button>
              <Button
                onClick={handleExecute}
                loading={executeMutation.isPending}
              >
                ✓ Confirm Import
              </Button>
            </div>
          </div>
        )}

        {/* ══ STEP 3: Done ════════════════════════════════════════ */}
        {step === 'done' && result && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-2">
              <p className="text-4xl">✅</p>
              <p className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>
                Import complete!
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              {[
                { label: 'Subjects created', value: result.subjectsCreated, emoji: '📚' },
                { label: 'Teachers created', value: result.teachersCreated, emoji: '👤' },
                { label: 'Lessons created', value: result.lessonsCreated, emoji: '📅' },
                { label: 'Lessons skipped', value: result.lessonsSkipped, emoji: '⏭' },
              ].map(({ label, value, emoji }) => (
                <div
                  key={label}
                  className="rounded-xl p-4 text-center"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <p className="text-2xl">{emoji}</p>
                  <p className="text-[22px] font-bold mt-1" style={{ color: 'var(--accent)' }}>
                    {value}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>{label}</p>
                </div>
              ))}
            </div>

            {result.warnings.length > 0 && (
              <div
                className="rounded-lg p-4 space-y-1 max-h-40 overflow-y-auto"
                style={{ background: '#FFFBEB', border: '1px solid #FCD34D' }}
              >
                <p className="text-[12px] font-semibold text-amber-800">Warnings</p>
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-amber-700">{w}</p>
                ))}
              </div>
            )}

            <div className="flex justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => { setStep('upload'); setFile(null); setPreview(null); setResult(null) }}
              >
                Import another file
              </Button>
              <Button onClick={() => navigate('/lessons')}>
                View Lessons →
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ─── Small sub-components ─────────────────────────────────────

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        {title} <span className="font-normal">({count})</span>
      </h3>
      {children}
    </div>
  )
}

function TypeBadge({ type, mathLevel }: { type: LessonType; mathLevel?: MathLevel }) {
  return (
    <span
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
      style={{
        background: `${TYPE_COLOR[type]}20`,
        color: TYPE_COLOR[type],
      }}
    >
      {TYPE_LABEL[type]}
      {mathLevel ? ` · ${MATH_LEVEL_LABEL[mathLevel]}` : ''}
    </span>
  )
}
