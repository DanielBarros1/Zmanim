/**
 * AutoSchedulerModal — configure and launch the auto-scheduler.
 *
 * The auto-scheduler (AS) runs as a background worker thread on the server.
 * This modal lets the admin:
 *   1. Configure: max restarts (default 10), time limit (default 30s)
 *   2. Launch: POST /api/schedules/auto → { jobId }
 *   3. Poll: GET /api/schedules/auto/:jobId every 2s
 *   4. On success: creates a new DRAFT schedule on the server,
 *      redirects to the editor for that schedule + enters Review Mode.
 *
 * The server-side algorithm:
 *   - Random-restart local search (hill climbing)
 *   - Penalty minimization using the same evaluator as the editor
 *   - Places all lessons, respects hard invariants (D1-D3)
 *   - Progress is streamed as { type: 'progress', progress: 0-100 }
 *
 * UI states:
 *   idle → configuring → running (with progress bar) → done / error
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useStartAutoScheduler, fetchJobStatus } from '../../api/schedules'
import { useUIStore } from '../../store/uiStore'

interface AutoSchedulerModalProps {
  open: boolean
  onClose: () => void
}

type UIState = 'config' | 'running' | 'done' | 'error'

export function AutoSchedulerModal({ open, onClose }: AutoSchedulerModalProps) {
  const navigate = useNavigate()
  const { setReviewMode } = useUIStore()
  const startAS = useStartAutoScheduler()

  // Config
  const [maxRestarts, setMaxRestarts] = useState(10)
  const [timeLimitSec, setTimeLimitSec] = useState(30)

  // Runtime
  const [uiState, setUiState] = useState<UIState>('config')
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup polling on unmount or close
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current)
      setUiState('config')
      setProgress(0)
      setJobId(null)
      setErrorMsg('')
    }
  }, [open])

  // Poll job status while running
  useEffect(() => {
    if (uiState !== 'running' || !jobId) return

    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchJobStatus(jobId)
        setProgress(status.progress)

        if (status.status === 'done' && status.scheduleId) {
          clearInterval(pollRef.current!)
          setUiState('done')
          // Give a moment for the user to see 100%, then redirect
          setTimeout(() => {
            setReviewMode(true)
            navigate(`/schedules/${status.scheduleId}`)
            onClose()
          }, 1200)
        } else if (status.status === 'error') {
          clearInterval(pollRef.current!)
          setUiState('error')
          setErrorMsg(status.error ?? 'Auto-scheduler failed.')
        }
      } catch (err) {
        clearInterval(pollRef.current!)
        setUiState('error')
        setErrorMsg('Lost connection to server.')
      }
    }, 2000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [uiState, jobId, navigate, setReviewMode, onClose])

  const handleStart = async () => {
    try {
      setUiState('running')
      setProgress(0)
      const job = await startAS.mutateAsync({
        maxRestarts,
        timeLimitMs: timeLimitSec * 1000,
      })
      setJobId(job.jobId)
    } catch (err) {
      setUiState('error')
      setErrorMsg('Failed to start auto-scheduler.')
    }
  }

  const handleClose = () => {
    if (uiState === 'running') return // don't close while running
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Auto-Scheduler"
      width="max-w-md"
    >
      {uiState === 'config' && (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
            The auto-scheduler will attempt to place all lessons automatically
            using a constraint-minimizing search. The result will be saved as
            a new draft schedule and opened in Review Mode.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Max restarts"
              type="number"
              min={1}
              max={50}
              value={maxRestarts}
              onChange={e => setMaxRestarts(Number(e.target.value))}
            />
            <Input
              label="Time limit (seconds)"
              type="number"
              min={5}
              max={300}
              value={timeLimitSec}
              onChange={e => setTimeLimitSec(Number(e.target.value))}
            />
          </div>

          <div
            className="px-3 py-2 rounded-md text-[12px]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <p className="font-medium text-[var(--text-1)] mb-1">What it does:</p>
            <ul className="text-[var(--text-2)] space-y-0.5 list-disc pl-4">
              <li>Places all lessons from the pool</li>
              <li>Respects hard invariants (no double-booking)</li>
              <li>Minimizes soft constraint violations</li>
              <li>Runs {maxRestarts} restart{maxRestarts > 1 ? 's' : ''} with ~{timeLimitSec}s budget</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleStart} loading={startAS.isPending}>
              🚀 Run Auto-Scheduler
            </Button>
          </div>
        </div>
      )}

      {uiState === 'running' && (
        <div className="space-y-5 py-4">
          <div className="text-center">
            <p className="text-3xl mb-2">⚙️</p>
            <p className="text-[15px] font-semibold text-[var(--text-1)]">
              Running Auto-Scheduler…
            </p>
            <p className="text-[12px] text-[var(--text-3)] mt-1">
              This may take up to {timeLimitSec} seconds.
            </p>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div
              className="h-3 rounded-full overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
            <p className="text-center text-[11px] text-[var(--text-3)]">
              {progress}% complete
            </p>
          </div>

          <p className="text-center text-[11px] text-[var(--text-3)]">
            Do not close this window while the scheduler is running.
          </p>
        </div>
      )}

      {uiState === 'done' && (
        <div className="text-center py-6 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="text-[15px] font-semibold text-[var(--ok-text)]">
            Schedule generated!
          </p>
          <p className="text-[12px] text-[var(--text-3)]">
            Opening in Review Mode…
          </p>
        </div>
      )}

      {uiState === 'error' && (
        <div className="space-y-4">
          <div className="text-center py-4">
            <p className="text-4xl">❌</p>
            <p className="text-[14px] font-semibold text-red-600 mt-2">
              Auto-scheduler failed
            </p>
            <p className="text-[12px] text-[var(--text-2)] mt-1">{errorMsg}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUiState('config')}>
              Try again
            </Button>
            <Button variant="ghost" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
