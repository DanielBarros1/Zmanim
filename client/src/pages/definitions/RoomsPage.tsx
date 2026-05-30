/**
 * RoomsPage — manage classroom inventory.
 *
 * Rooms have:
 *   - name (Hebrew)
 *   - capacity: STANDARD | LARGE
 *
 * LARGE rooms are auto-selected for SHARED lessons (two-class lessons).
 * Specialized rooms are linked per-subject (in SubjectsPage).
 */

import { useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import {
  useRooms,
  useCreateRoom,
  useUpdateRoom,
  useDeleteRoom,
} from '../../api/rooms'
import { RoomCapacity } from '@zmanim/shared'
import type { Room } from '@zmanim/shared'

interface FormState {
  name: string
  capacity: RoomCapacity
}

const EMPTY_FORM: FormState = { name: '', capacity: RoomCapacity.STANDARD }

function RoomForm({
  initial,
  onSave,
  onCancel,
  loading,
  error,
}: {
  initial: FormState
  onSave: (f: FormState) => void
  onCancel: () => void
  loading: boolean
  error?: string
}) {
  const [form, setForm] = useState(initial)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Room name (Hebrew)"
        placeholder="כיתה א׳"
        value={form.name}
        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
        isHebrew
        required
        autoFocus
      />
      <Select
        label="Capacity"
        value={form.capacity}
        onChange={e => setForm(p => ({ ...p, capacity: e.target.value as RoomCapacity }))}
      >
        <option value={RoomCapacity.STANDARD}>Standard</option>
        <option value={RoomCapacity.LARGE}>Large (for shared lessons)</option>
      </Select>
      {error && (
        <p className="text-[12px] text-red-500 rounded-md px-3 py-2" style={{ background: 'var(--warn-bg)' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Save Room
        </Button>
      </div>
    </form>
  )
}

export function RoomsPage() {
  const { data: rooms = [], isLoading } = useRooms()
  const createRoom = useCreateRoom()
  const updateRoom = useUpdateRoom()
  const deleteRoom = useDeleteRoom()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<Room | null>(null)
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null)
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [createError, setCreateError] = useState<string>()
  const [editError, setEditError] = useState<string>()

  const handleCreate = async (form: FormState) => {
    setCreateError(undefined)
    try {
      await createRoom.mutateAsync({ name: form.name.trim(), capacity: form.capacity })
      setModalOpen(false)
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to save room.')
    }
  }

  const handleUpdate = async (form: FormState) => {
    if (!editingRoom) return
    setEditError(undefined)
    try {
      await updateRoom.mutateAsync({
        id: editingRoom.id,
        data: { name: form.name.trim(), capacity: form.capacity },
      })
      setEditingRoom(null)
    } catch (err: any) {
      setEditError(err?.response?.data?.error ?? 'Failed to update room.')
    }
  }

  const handleDelete = async () => {
    if (!deletingRoom) return
    setDeleteError(undefined)
    try {
      await deleteRoom.mutateAsync(deletingRoom.id)
      setDeletingRoom(null)
      setDeleteError(undefined)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error ?? 'Failed to delete room.')
    }
  }

  const [search, setSearch] = useState('')
  const filteredRooms = rooms.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
  const standardRooms = filteredRooms.filter(r => r.capacity === RoomCapacity.STANDARD)
  const largeRooms = filteredRooms.filter(r => r.capacity === RoomCapacity.LARGE)

  if (isLoading) {
    return (
      <AppShell title="Rooms">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  const RoomRow = ({ room }: { room: Room }) => (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-lg border"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <span className="text-lg">🏫</span>
      <span className="flex-1 text-[14px] font-medium text-[var(--text-1)] hebrew">
        {room.name}
      </span>
      <Badge variant={room.capacity === RoomCapacity.LARGE ? 'accent' : 'neutral'}>
        {room.capacity === RoomCapacity.LARGE ? 'Large' : 'Standard'}
      </Badge>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditingRoom(room)}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeletingRoom(room)}
          className="text-red-500 hover:text-red-600"
        >
          Delete
        </Button>
      </div>
    </div>
  )

  return (
    <AppShell
      title="Rooms"
      actions={<Button onClick={() => setModalOpen(true)}>+ New Room</Button>}
    >
      {rooms.length === 0 ? (
        <EmptyState
          icon="🏫"
          title="No rooms yet"
          description="Add classrooms to enable room assignment during scheduling."
          action={<Button onClick={() => setModalOpen(true)}>+ New Room</Button>}
        />
      ) : (
        <>
          <input
            type="search"
            placeholder="Search rooms…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mb-3 w-full max-w-xs rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          />
        <div className="space-y-6">
          {largeRooms.length > 0 && (
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-2">
                Large Rooms ({largeRooms.length})
              </h2>
              <div className="space-y-2">
                {largeRooms.map(r => <RoomRow key={r.id} room={r} />)}
              </div>
            </div>
          )}
          {standardRooms.length > 0 && (
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)] mb-2">
                Standard Rooms ({standardRooms.length})
              </h2>
              <div className="space-y-2">
                {standardRooms.map(r => <RoomRow key={r.id} room={r} />)}
              </div>
            </div>
          )}
        </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setCreateError(undefined) }}
        title="New Room"
      >
        <RoomForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => { setModalOpen(false); setCreateError(undefined) }}
          loading={createRoom.isPending}
          error={createError}
        />
      </Modal>

      <Modal
        open={!!editingRoom}
        onClose={() => { setEditingRoom(null); setEditError(undefined) }}
        title="Edit Room"
      >
        {editingRoom && (
          <RoomForm
            initial={{ name: editingRoom.name, capacity: editingRoom.capacity }}
            onSave={handleUpdate}
            onCancel={() => { setEditingRoom(null); setEditError(undefined) }}
            loading={updateRoom.isPending}
            error={editError}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingRoom}
        onClose={() => { setDeletingRoom(null); setDeleteError(undefined) }}
        onConfirm={handleDelete}
        title={`Delete "${deletingRoom?.name}"?`}
        description="Existing schedule placements will keep their slot but lose their room assignment."
        confirmLabel="Delete Room"
        danger
        loading={deleteRoom.isPending}
        error={deleteError}
      />
    </AppShell>
  )
}
