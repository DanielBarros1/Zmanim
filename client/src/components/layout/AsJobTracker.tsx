/**
 * AsJobTracker — mounts once inside AppShell and tracks any background
 * auto-scheduler job stored in uiStore.activeAsJob.
 *
 * Polls the job status endpoint every 3 s while a job is active.
 * On completion (DONE / ERROR) it:
 *   - pushes a toast notification
 *   - invalidates the schedules list so the new draft appears immediately
 *   - clears activeAsJob from the store
 *
 * The component renders nothing itself — it's purely a side-effect hook.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../store/uiStore'
import { fetchJobStatus, SCHEDULES_KEY } from '../../api/schedules'
import { ToastStack, type ToastData } from '../ui/Toast'

let _toastCounter = 0
function newId() { return `toast-${++_toastCounter}` }

export function AsJobTracker() {
  const { activeAsJob, setActiveAsJob, setReviewMode } = useUIStore()
  const queryClient = useQueryClient()
  const navigate    = useNavigate()
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const failsRef    = useRef(0)

  const [toasts, setToasts] = useState<ToastData[]>([])

  const dismissToast = (id: string) =>
    setToasts(prev => prev.filter(t => t.id !== id))

  const pushToast = (t: Omit<ToastData, 'id'>) =>
    setToasts(prev => [...prev, { ...t, id: newId() }])

  useEffect(() => {
    if (!activeAsJob) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    failsRef.current = 0

    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchJobStatus(activeAsJob.jobId)
        failsRef.current = 0

        if (status.status === 'DONE') {
          clearInterval(pollRef.current!)
          setActiveAsJob(null)
          // Refresh the schedules list so new drafts appear
          queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY })

          const best = status.candidates?.[0]
          const nnViol = best?.violations.nonNegotiable ?? 0
          const totalViol = best?.violations.total ?? 0

          pushToast({
            type: 'success',
            title: `Auto-scheduler done — "${activeAsJob.name}"`,
            message: best
              ? (nnViol === 0
                  ? `Best result: ${totalViol === 0 ? 'no violations 🎉' : `${totalViol} soft violations`}`
                  : `Best result: ${nnViol} non-negotiable violation${nnViol > 1 ? 's' : ''}`
                )
              : 'Schedule saved.',
            duration: 12000,
            action: best
              ? {
                  label: 'Open best schedule',
                  onClick: () => {
                    setReviewMode(true)
                    navigate(`/schedules/${best.scheduleId}`)
                  },
                }
              : undefined,
          })
        } else if (status.status === 'ERROR') {
          clearInterval(pollRef.current!)
          setActiveAsJob(null)
          pushToast({
            type: 'error',
            title: `Auto-scheduler failed — "${activeAsJob.name}"`,
            message: status.error ?? 'Unknown error.',
            duration: 15000,
          })
        }
      } catch {
        failsRef.current++
        if (failsRef.current >= 5) {
          clearInterval(pollRef.current!)
          setActiveAsJob(null)
          pushToast({
            type: 'error',
            title: 'Lost connection to auto-scheduler',
            message: 'The job may still be running — check the Schedules page.',
            duration: 12000,
          })
        }
      }
    }, 3000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsJob?.jobId])

  return <ToastStack toasts={toasts} onDismiss={dismissToast} />
}
