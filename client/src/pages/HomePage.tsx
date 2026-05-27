/**
 * HomePage — schedule list.
 *
 * Shows all schedules as cards with:
 *   - Name + edit pencil
 *   - State badge (DRAFT / PUBLISHED)
 *   - Star toggle
 *   - Placement progress bar (placed / total)
 *   - Created date
 *   - Actions: Open editor, Clone, Delete
 *
 * The published schedule (if any) is highlighted at the top with a
 * distinct border.
 *
 * "New Schedule" button opens a creation modal.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/ui/EmptyState'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { SkeletonCard } from '../components/ui/Skeleton'
import { AutoSchedulerModal } from '../components/schedule/AutoSchedulerModal'
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useCloneSchedule,
  usePublishSchedule,
} from '../api/schedules'
import { ScheduleState } from '@zmanim/shared'
import type { ScheduleSummary } from '@zmanim/shared'

function ProgressBar({ placed, total }: { placed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((placed / total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: pct === 100 ? 'var(--ok-text)' : 'var(--accent)',
          }}
        />
      </div>
      <span className="text-[11px] text-[var(--text-3)] tabular-nums w-16 text-right">
        {placed}/{total} ({pct}%)
      </span>
    </div>
  )
}

function ScheduleCard({
  schedule,
  onOpen,
  onClone,
  onDelete,
  onPublish,
  onToggleStar,
  onRename,
}: {
  schedule: ScheduleSummary
  onOpen: () => void
  onClone: () => void
  onDelete: () => void
  onPublish: () => void
  onToggleStar: () => void
  onRename: (name: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(schedule.name)
  const isPublished = schedule.state === ScheduleState.PUBLISHED

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (nameInput.trim()) {
      onRename(nameInput.trim())
    }
    setRenaming(false)
  }

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-4 transition-shadow hover:shadow-md"
      style={{
        background: 'var(--surface)',
        borderColor: isPublished ? 'var(--accent)' : 'var(--border)',
        boxShadow: isPublished ? '0 0 0 1px var(--accent)' : 'var(--card-shadow)',
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Star */}
        <button
          onClick={onToggleStar}
          className="mt-0.5 text-lg leading-none transition-transform hover:scale-110"
          title={schedule.isStarred ? 'Unstar' : 'Star'}
        >
          {schedule.isStarred ? '⭐' : '☆'}
        </button>

        {/* Name */}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <form onSubmit={handleRenameSubmit} className="flex gap-2">
              <input
                className="flex-1 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-[14px] text-[var(--text-1)] focus:outline-none"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                autoFocus
                onBlur={() => setRenaming(false)}
              />
              <Button type="submit" size="sm">Save</Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h2
                className="text-[15px] font-semibold text-[var(--text-1)] truncate cursor-pointer hover:text-[var(--accent)]"
                onClick={onOpen}
              >
                {schedule.name}
              </h2>
              <button
                onClick={() => { setNameInput(schedule.name); setRenaming(true) }}
                className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors text-[12px]"
                title="Rename"
              >
                ✏️
              </button>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-3)] mt-0.5">
            {new Date(schedule.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* State badge */}
        <Badge variant={isPublished ? 'published' : 'draft'}>
          {isPublished ? 'Published' : 'Draft'}
        </Badge>
      </div>

      {/* Progress */}
      <ProgressBar placed={schedule.totalPlaced} total={schedule.totalRequired} />

      {/* Action row */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={onOpen} size="sm">
          Open Editor →
        </Button>
        {!isPublished && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onPublish}
            title="Set as the active published schedule"
          >
            Publish
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClone} title="Duplicate this schedule">
          Clone
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-500 hover:text-red-600 ml-auto"
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

export function HomePage() {
  const { data: schedules = [], isLoading } = useSchedules()
  const createSchedule = useCreateSchedule()
  const updateSchedule = useUpdateSchedule()
  const deleteSchedule = useDeleteSchedule()
  const cloneSchedule = useCloneSchedule()
  const publishSchedule = usePublishSchedule()
  const navigate = useNavigate()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [asOpen, setAsOpen] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const schedule = await createSchedule.mutateAsync({ name: newName.trim() })
    setCreateOpen(false)
    setNewName('')
    navigate(`/schedules/${schedule.id}`)
  }

  const handleDelete = async () => {
    if (!deletingId) return
    await deleteSchedule.mutateAsync(deletingId)
    setDeletingId(null)
  }

  // Sort: published first, then starred, then by updatedAt desc
  const sorted = [...schedules].sort((a, b) => {
    if (a.state === ScheduleState.PUBLISHED) return -1
    if (b.state === ScheduleState.PUBLISHED) return 1
    if (a.isStarred && !b.isStarred) return -1
    if (!a.isStarred && b.isStarred) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  if (isLoading) {
    return (
      <AppShell title="Schedules">
        <div className="grid gap-4 max-w-3xl">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Schedules"
      actions={
        <Button variant="secondary" onClick={() => setAsOpen(true)}>⚙ Auto-Schedule</Button>
        <Button onClick={() => setCreateOpen(true)}>+ New Schedule</Button>
      }
    >
      {sorted.length === 0 ? (
        <EmptyState
          icon="🗓️"
          title="No schedules yet"
          description="Create your first schedule to start planning the school week."
          action={
            <Button onClick={() => setCreateOpen(true)}>+ New Schedule</Button>
          }
        />
      ) : (
        <div className="grid gap-4 max-w-3xl">
          {sorted.map(schedule => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onOpen={() => navigate(`/schedules/${schedule.id}`)}
              onClone={() => cloneSchedule.mutate(schedule.id)}
              onDelete={() => setDeletingId(schedule.id)}
              onPublish={() => publishSchedule.mutate(schedule.id)}
              onToggleStar={() =>
                updateSchedule.mutate({
                  id: schedule.id,
                  data: { isStarred: !schedule.isStarred },
                })
              }
              onRename={name => updateSchedule.mutate({ id: schedule.id, data: { name } })}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Schedule"
        width="max-w-sm"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Schedule name"
            placeholder="Semester 1 — 2026"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            required
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createSchedule.isPending}>
              Create Schedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete schedule?"
        description="All lesson placements in this schedule will be permanently removed. This cannot be undone."
        confirmLabel="Delete Schedule"
        danger
        loading={deleteSchedule.isPending}
      />

      {/* Auto-scheduler modal */}
      <AutoSchedulerModal open={asOpen} onClose={() => setAsOpen(false)} />
    </AppShell>
  )
}
