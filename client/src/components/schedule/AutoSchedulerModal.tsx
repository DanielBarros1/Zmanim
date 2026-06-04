/**
 * AutoSchedulerModal — configure, launch, and select from the auto-scheduler results.
 *
 * States:
 *   config    → admin fills in name, seed schedule, nRestarts, nIterations
 *   running   → AS job is in progress; poll every 2 s
 *   selecting → AS done; admin picks one of up to 3 candidate schedules
 *   error     → something went wrong
 *
 * On selection the other candidates are deleted automatically so they don't
 * clutter the schedule list.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useStartAutoScheduler, fetchJobStatus } from '../../api/schedules'
import type { CandidateResult } from '../../api/schedules'
import { useSchedules } from '../../api/schedules'
import { useUIStore } from '../../store/uiStore'
import { useLessons } from '../../api/lessons'
import { useClasses, useGrades } from '../../api/grades'
import { useConfig } from '../../api/config'
import apiClient from '../../api/client'
import type { Grade, Class } from '@zmanim/shared'

interface AutoSchedulerModalProps {
  open: boolean
  onClose: () => void
}

type UIState = 'config' | 'running' | 'selecting' | 'error'

// ─── Violation severity badge ──────────────────────────────────

function ViolBadge({
  count,
  label,
  color,
  bg,
}: { count: number; label: string; color: string; bg: string }) {
  if (count === 0) return null
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{ background: bg, color }}
    >
      {count} {label}
    </span>
  )
}

// ─── Candidate card ────────────────────────────────────────────

function CandidateCard({
  candidate,
  rank,
  checked,
  onToggle,
  onOpen,
  isOpening,
}: {
  candidate: CandidateResult
  rank: number
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  isOpening: boolean
}) {
  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
  const isClean   = candidate.violations.nonNegotiable === 0
  const totalViol = candidate.violations.total

  return (
    <div
      className="rounded-lg p-4 border transition-all cursor-pointer"
      style={{
        background:  checked ? 'var(--accent-bg)' : 'var(--surface)',
        borderColor: checked ? 'var(--accent)' : 'var(--border)',
        borderWidth: checked ? 2 : 1,
      }}
      onClick={onToggle}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Checkbox */}
        <div
          className="mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all"
          style={{
            borderColor:     checked ? 'var(--accent)' : 'var(--text-3)',
            background:      checked ? 'var(--accent)' : 'transparent',
          }}
          onClick={e => { e.stopPropagation(); onToggle() }}
        >
          {checked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px]">{rankEmoji}</span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                {rank === 1 ? 'Best Result' : rank === 2 ? 'Runner-up' : 'Third Option'}
              </span>
            </div>
            {isClean && (
              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: '#D1FAE5', color: '#065F46' }}>
                ✓ Clean
              </span>
            )}
          </div>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {candidate.name}
          </p>
        </div>
      </div>

      {/* Violation breakdown */}
      <div className="mb-3 pl-7 space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          Violations
        </p>
        {totalViol === 0 ? (
          <p className="text-[11px]" style={{ color: '#059669' }}>None — perfect schedule</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            <ViolBadge count={candidate.violations.nonNegotiable} label="Non-neg."  color="#991B1B" bg="#FEE2E2" />
            <ViolBadge count={candidate.violations.important}     label="Important" color="#92400E" bg="#FEF3C7" />
            <ViolBadge count={candidate.violations.preferred}     label="Preferred" color="#1E40AF" bg="#DBEAFE" />
            <ViolBadge count={candidate.violations.flexible}      label="Flexible"  color="var(--text-3)" bg="var(--surface-2)" />
          </div>
        )}
      </div>

      {/* Open button — stops card-click from toggling */}
      <div className="pl-7">
        <Button
          size="sm"
          variant="ghost"
          onClick={e => { e.stopPropagation(); onOpen() }}
          loading={isOpening}
        >
          {isOpening ? 'Opening…' : '↗ Open in Review Mode'}
        </Button>
      </div>
    </div>
  )
}

// ─── Pre-flight capacity check ────────────────────────────────
//
// Computes assigned h/wk per class and compares to available slots.
// Runs entirely client-side from cached data — instant, no network call.
//
// "Assigned h/wk for class C" = sum of hoursPerWeek for every lesson
// that involves C either via classIds or (for group lessons) via gradeId.
//
// A class with assigned > available is provably infeasible — the AS will
// always fail regardless of restarts.  We show this before running so the
// user knows to fix their lesson plan rather than waste time watching it fail.

interface ClassCapacity {
  classId: string
  label: string    // "9A", "12B", etc.
  gradeNumber: number
  assigned: number
  available: number
  pct: number      // assigned / available, may exceed 1.0
}

function useCapacityCheck(grades: Grade[], classes: Class[]) {
  const { data: lessons = [] } = useLessons()
  const { data: config } = useConfig()

  return useMemo<ClassCapacity[]>(() => {
    if (!config || classes.length === 0) return []

    const available = config.slotsPerDay * config.workDays.length

    // Map gradeId → class IDs for group-lesson expansion
    const classesByGrade: Record<string, string[]> = {}
    for (const cls of classes) {
      if (!classesByGrade[cls.gradeId]) classesByGrade[cls.gradeId] = []
      classesByGrade[cls.gradeId].push(cls.id)
    }

    const hoursPerClass: Record<string, number> = {}

    for (const lesson of lessons) {
      // Determine which class IDs this lesson contributes to
      let affectedClassIds = [...lesson.classIds]
      // MATH_GROUP / ENGLISH_GROUP use gradeId instead of classIds
      if (affectedClassIds.length === 0 && lesson.gradeId) {
        affectedClassIds = classesByGrade[lesson.gradeId] ?? []
      }
      for (const cid of affectedClassIds) {
        hoursPerClass[cid] = (hoursPerClass[cid] ?? 0) + lesson.hoursPerWeek
      }
    }

    const gradeById = Object.fromEntries(grades.map(g => [g.id, g]))

    return classes
      .map(cls => {
        const grade = gradeById[cls.gradeId]
        const assigned = hoursPerClass[cls.id] ?? 0
        return {
          classId: cls.id,
          label: grade ? `${grade.number}${cls.section}` : cls.section,
          gradeNumber: grade?.number ?? 0,
          assigned,
          available,
          pct: available > 0 ? assigned / available : 0,
        }
      })
      .sort((a, b) => a.gradeNumber - b.gradeNumber || a.label.localeCompare(b.label))
  }, [lessons, classes, grades, config])
}

function FeasibilityPanel({ grades, classes }: { grades: Grade[]; classes: Class[] }) {
  const capacity = useCapacityCheck(grades, classes)
  const [expanded, setExpanded] = useState(false)

  if (capacity.length === 0) return null

  const overloaded  = capacity.filter(c => c.assigned > c.available)
  const tight       = capacity.filter(c => c.assigned === c.available)
  const hasProblems = overloaded.length > 0

  // Collapsed summary chip
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors hover:border-[var(--accent)]"
        style={{
          background:   hasProblems ? '#FEF2F2' : 'var(--surface-2)',
          borderColor:  hasProblems ? '#FECACA' : 'var(--border)',
        }}
      >
        <span className="text-[12px] font-medium" style={{ color: hasProblems ? '#DC2626' : 'var(--text-2)' }}>
          {hasProblems
            ? `⛔ ${overloaded.length} class${overloaded.length > 1 ? 'es' : ''} over capacity — click to see details`
            : tight.length > 0
            ? `⚠️ ${tight.length} class${tight.length > 1 ? 'es' : ''} at exactly full capacity`
            : `✓ Capacity check passed (${capacity.length} classes)`}
        </span>
        <span className="text-[11px] text-[var(--text-3)]">▼</span>
      </button>
    )
  }

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: hasProblems ? '#FECACA' : 'var(--border)' }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ background: hasProblems ? '#FEF2F2' : 'var(--surface-2)' }}
      >
        <span className="text-[12px] font-semibold" style={{ color: hasProblems ? '#DC2626' : 'var(--text-1)' }}>
          Class capacity — {capacity[0]?.available ?? 0} slots/week available
        </span>
        <span className="text-[11px] text-[var(--text-3)]">▲</span>
      </button>

      {/* Class rows */}
      <div
        className="divide-y px-3 py-2 max-h-56 overflow-y-auto"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {capacity.map(c => {
          const isOver  = c.assigned > c.available
          const isFull  = c.assigned === c.available
          const barPct  = Math.min(c.pct * 100, 100)
          const barColor = isOver ? '#EF4444' : isFull ? '#F59E0B' : '#22C55E'

          return (
            <div key={c.classId} className="flex items-center gap-3 py-1.5">
              {/* Class label */}
              <span
                className="w-7 text-[11px] font-bold tabular-nums shrink-0 text-right"
                style={{ color: isOver ? '#DC2626' : 'var(--text-2)' }}
              >
                {c.label}
              </span>

              {/* Progress bar */}
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barPct}%`, background: barColor }}
                />
              </div>

              {/* Numbers */}
              <span
                className="text-[11px] tabular-nums shrink-0 w-24 text-right"
                style={{ color: isOver ? '#DC2626' : isFull ? '#D97706' : 'var(--text-3)' }}
              >
                {isOver
                  ? `${c.assigned}/${c.available} ⛔ +${c.assigned - c.available}`
                  : isFull
                  ? `${c.assigned}/${c.available} ⚠️ full`
                  : `${c.assigned}/${c.available}`}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      {hasProblems && (
        <div className="px-3 py-2 text-[11px]" style={{ background: '#FEF2F2', color: '#DC2626' }}>
          Remove or reduce hours for the red classes in the Lessons page before running.
        </div>
      )}
    </div>
  )
}

// ─── Main modal ────────────────────────────────────────────────

export function AutoSchedulerModal({ open, onClose }: AutoSchedulerModalProps) {
  const navigate = useNavigate()
  const { setReviewMode } = useUIStore()
  const startAS = useStartAutoScheduler()
  const { data: schedules = [] } = useSchedules()
  const { data: grades = [] }   = useGrades()
  const { data: classes = [] }  = useClasses()

  // ── Capacity check (derived from grades/classes, used by FeasibilityPanel) ──
  const capacity = useCapacityCheck(grades, classes)
  const isInfeasible = capacity.some(c => c.assigned > c.available)

  // ── Config state ────────────────────────────────────────────────
  const [name, setName] = useState(() => {
    const d = new Date()
    return `Auto Schedule ${d.toLocaleDateString('en-IL')}`
  })
  const [seedScheduleId, setSeedScheduleId] = useState<string>('')
  const [nRestarts, setNRestarts] = useState(50)
  const [nIterations, setNIterations] = useState(1000)

  // ── Runtime state ───────────────────────────────────────────────
  const [uiState, setUiState] = useState<UIState>('config')
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [candidates, setCandidates]     = useState<CandidateResult[]>([])
  const [checkedIds, setCheckedIds]     = useState<Set<string>>(new Set())
  const [openingId,  setOpeningId]      = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollFailsRef = useRef(0)

  // ── Reset on close ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollFailsRef.current = 0
      setUiState('config')
      setProgress(0)
      setStatusMessage('')
      setJobId(null)
      setErrorMsg('')
      setCandidates([])
      setCheckedIds(new Set())
      setOpeningId(null)
    }
  }, [open])

  // ── Poll job status while running ───────────────────────────────
  useEffect(() => {
    if (uiState !== 'running' || !jobId) return

    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchJobStatus(jobId)
        pollFailsRef.current = 0
        setProgress(status.progress)
        if (status.statusMessage) setStatusMessage(status.statusMessage)

        if (status.status === 'DONE' && status.candidates && status.candidates.length > 0) {
          clearInterval(pollRef.current!)
          setCandidates(status.candidates)
          // Pre-check all candidates — admin can uncheck the ones they don't want
          setCheckedIds(new Set(status.candidates.map(c => c.scheduleId)))
          setUiState('selecting')
        } else if (status.status === 'DONE' && status.scheduleId) {
          // Fallback for single-candidate response
          clearInterval(pollRef.current!)
          setUiState('selecting')
          setCandidates([{
            scheduleId: status.scheduleId,
            name,
            score: 0,
            violations: { total: 0, nonNegotiable: 0, important: 0, preferred: 0, flexible: 0 },
          }])
        } else if (status.status === 'ERROR') {
          clearInterval(pollRef.current!)
          setUiState('error')
          setErrorMsg(status.error ?? 'Auto-scheduler failed.')
        }
      } catch {
        pollFailsRef.current++
        if (pollFailsRef.current >= 5) {
          clearInterval(pollRef.current!)
          setUiState('error')
          setErrorMsg('Lost connection to server.')
        }
      }
    }, 2000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [uiState, jobId, name, navigate, setReviewMode, onClose])

  // ── Handlers ────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!name.trim()) return
    try {
      setUiState('running')
      setProgress(0)
      const job = await startAS.mutateAsync({
        name: name.trim(),
        seedScheduleId: seedScheduleId || undefined,
        config: { nRestarts, nIterations },
      })
      setJobId(job.jobId)
    } catch (err: any) {
      setUiState('error')
      setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Failed to start auto-scheduler.')
    }
  }

  const toggleCandidate = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Open one candidate in Review Mode without discarding anything */
  const handleOpenCandidate = async (id: string) => {
    setOpeningId(id)
    setReviewMode(true)
    navigate(`/schedules/${id}`)
    onClose()
  }

  /** Discard unchecked candidates, then open the best remaining one */
  const handleConfirmSelection = async () => {
    if (checkedIds.size === 0) return
    const toDelete = candidates.filter(c => !checkedIds.has(c.scheduleId))
    await Promise.allSettled(toDelete.map(c => apiClient.delete(`/api/schedules/${c.scheduleId}`)))
    // Open the first checked (highest-ranked) candidate
    const best = candidates.find(c => checkedIds.has(c.scheduleId))
    if (best) {
      setReviewMode(true)
      navigate(`/schedules/${best.scheduleId}`)
    }
    onClose()
  }

  const handleClose = () => {
    if (uiState === 'running') return
    onClose()
  }

  // Modal is wider during selection so all 3 cards fit comfortably
  const modalWidth = uiState === 'selecting' ? 'max-w-2xl' : 'max-w-lg'

  // ── Render ──────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={handleClose} title="Auto-Scheduler" width={modalWidth}>

      {/* ── Config ── */}
      {uiState === 'config' && (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
            The auto-scheduler places all lessons automatically using a constraint-minimizing
            search. Up to 3 candidate schedules are saved so you can compare and pick the best one.
          </p>

          <Input
            label="New schedule name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Auto Schedule 28/5/2026"
          />

          <div className="space-y-1">
            <label className="block text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              Seed from existing schedule{' '}
              <span className="font-normal text-[var(--text-3)]">(optional)</span>
            </label>
            <select
              value={seedScheduleId}
              onChange={e => setSeedScheduleId(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-[13px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="">— None (start from scratch) —</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.state === 'PUBLISHED' ? '✓ Published' : 'Draft'})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Input label="Restarts" type="number" min={1} max={200} value={nRestarts}
                onChange={e => setNRestarts(Number(e.target.value))} />
              <p className="text-[10px] text-[var(--text-3)]">More = better quality, slower</p>
            </div>
            <div className="space-y-1">
              <Input label="Iterations per restart" type="number" min={100} max={10000} step={100}
                value={nIterations} onChange={e => setNIterations(Number(e.target.value))} />
              <p className="text-[10px] text-[var(--text-3)]">Local search steps per restart</p>
            </div>
          </div>

          {/* Capacity check — shows over-allocated classes before wasting restarts */}
          <FeasibilityPanel grades={grades} classes={classes} />

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleStart}
              loading={startAS.isPending}
              disabled={!name.trim()}
              title={isInfeasible ? 'One or more classes are over capacity — the run will likely fail' : undefined}
            >
              {isInfeasible ? '⚠️ Run Anyway' : '🚀 Run Auto-Scheduler'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Running ── */}
      {uiState === 'running' && (
        <div className="space-y-5 py-4">
          <div className="text-center">
            <p className="text-3xl mb-3">⚙️</p>
            <p className="text-[15px] font-semibold text-[var(--text-1)]">Running Auto-Scheduler…</p>
          </div>

          <div className="space-y-1.5">
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress}%`, background: 'var(--accent)' }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-3)]">{progress}%</span>
              <span className="text-[11px] text-[var(--text-3)]">
                {nRestarts} restart{nRestarts !== 1 ? 's' : ''} × {nIterations.toLocaleString()} steps
              </span>
            </div>
          </div>

          <div
            className="px-3 py-2.5 rounded-md flex items-center gap-2.5 text-[12px]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: 'var(--accent)' }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--accent)' }} />
            </span>
            <span style={{ color: 'var(--text-2)' }}>{statusMessage || 'Starting…'}</span>
          </div>

          <p className="text-center text-[11px] text-[var(--text-3)]">
            Do not close this window while the scheduler is running.
          </p>
        </div>
      )}

      {/* ── Selecting ── */}
      {uiState === 'selecting' && (
        <div className="space-y-4">
          <div>
            <p className="text-[15px] font-semibold text-[var(--text-1)]">
              ✅ Done — {candidates.length} candidate schedule{candidates.length > 1 ? 's' : ''} found
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              Check the ones you want to keep, uncheck those you want to discard, then confirm.
              Or click ↗ on any card to open it immediately without discarding the others.
            </p>
          </div>

          <div className="space-y-3">
            {candidates.map((c, i) => (
              <CandidateCard
                key={c.scheduleId}
                candidate={c}
                rank={i + 1}
                checked={checkedIds.has(c.scheduleId)}
                onToggle={() => toggleCandidate(c.scheduleId)}
                onOpen={() => handleOpenCandidate(c.scheduleId)}
                isOpening={openingId === c.scheduleId}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {checkedIds.size} of {candidates.length} selected
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Keep all & close
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmSelection}
                disabled={checkedIds.size === 0}
              >
                Discard unselected & open best
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {uiState === 'error' && (
        <div className="space-y-4">
          <div className="text-center pt-2">
            <p className="text-4xl">❌</p>
            <p className="text-[15px] font-semibold text-red-600 mt-2">Auto-scheduler failed</p>
          </div>

          {/* Error message in a readable box */}
          <div
            className="rounded-lg p-3 text-[12px] leading-relaxed"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}
          >
            {errorMsg}
          </div>

          {/* Capacity check — often shows the root cause immediately */}
          {isInfeasible && (
            <div>
              <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text-1)' }}>
                Root cause — over-allocated classes:
              </p>
              <FeasibilityPanel grades={grades} classes={classes} />
            </div>
          )}

          {/* Actionable next steps */}
          <div
            className="rounded-lg p-3 space-y-1 text-[12px]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            <p className="font-semibold text-[var(--text-1)] mb-2">What to try:</p>
            {isInfeasible ? (
              <>
                <p>1. Go to <strong>Lessons</strong> and reduce hours for the red classes shown above.</p>
                <p>2. Or increase <strong>Slots per day</strong> in School Config.</p>
              </>
            ) : (
              <>
                <p>1. <strong>Run with more restarts</strong> — the search may need more time (try 2–3×).</p>
                <p>2. Check for very tight teacher constraints in <strong>Restrictions</strong>.</p>
                <p>3. Reduce total lesson hours or increase slots/day in <strong>School Config</strong>.</p>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!isInfeasible) setNRestarts(n => Math.min(n * 2, 200))
                setUiState('config')
              }}
            >
              {isInfeasible ? '← Back to config' : `↺ Try again with ${Math.min(nRestarts * 2, 200)} restarts`}
            </Button>
            <div className="flex gap-2">
              {isInfeasible && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { onClose(); navigate('/definitions/lessons') }}
                >
                  Go to Lessons →
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleClose}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
