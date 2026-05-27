/**
 * SubjectsPage — manage the subject catalogue.
 *
 * Each subject has:
 *   - name (Hebrew)
 *   - isArts (affects the arts-balance restriction B4)
 *   - color (hex — must be unique per design spec)
 *   - specializedRoomId (optional — links the subject to a room that must be used)
 *
 * The color palette from design-spec.md is offered as a preset picker.
 */

import { useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Checkbox } from '../../components/ui/Checkbox'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import {
  useSubjects,
  useCreateSubject,
  useUpdateSubject,
  useDeleteSubject,
} from '../../api/subjects'
import { useRooms } from '../../api/rooms'
import type { Subject } from '@zmanim/shared'

const PRESET_COLORS = [
  '#4F46E5', '#059669', '#DB2777', '#D97706', '#1D4ED8',
  '#7C3AED', '#15803D', '#DC2626', '#65A30D', '#0369A1',
  '#0F766E', '#C2410C', '#0891B2',
]

interface FormState {
  name: string
  isArts: boolean
  color: string
  specializedRoomId: string
}

const EMPTY_FORM: FormState = { name: '', isArts: false, color: '#4F46E5', specializedRoomId: '' }

function SubjectForm({
  initial,
  onSave,
  onCancel,
  loading,
  usedColors,
}: {
  initial: FormState
  onSave: (f: FormState) => void
  onCancel: () => void
  loading: boolean
  usedColors: string[]
}) {
  const [form, setForm] = useState(initial)
  const { data: rooms = [] } = useRooms()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Subject name (Hebrew)"
        placeholder="מתמטיקה"
        value={form.name}
        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
        isHebrew
        required
        autoFocus
      />

      <div>
        <p className="text-[12px] font-medium text-[var(--text-2)] mb-2">Color</p>
        <div className="flex gap-2 flex-wrap mb-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setForm(p => ({ ...p, color: c }))}
              className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: form.color === c ? 'var(--text-1)' : 'transparent',
                opacity: usedColors.includes(c) && form.color !== c ? 0.35 : 1,
              }}
              title={c}
            />
          ))}
        </div>
        <Input
          label="Custom hex"
          value={form.color}
          onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
          className="w-36"
        />
      </div>

      <Checkbox
        label="Arts subject (for arts-balance restriction)"
        checked={form.isArts}
        onChange={e => setForm(p => ({ ...p, isArts: e.target.checked }))}
      />

      <Select
        label="Specialized room (optional)"
        value={form.specializedRoomId}
        onChange={e => setForm(p => ({ ...p, specializedRoomId: e.target.value }))}
      >
        <option value="">None</option>
        {rooms.map(r => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.capacity})
          </option>
        ))}
      </Select>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Save Subject
        </Button>
      </div>
    </form>
  )
}

export function SubjectsPage() {
  const { data: subjects = [], isLoading } = useSubjects()
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()
  const deleteSubject = useDeleteSubject()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
  const [deletingSubject, setDeletingSubject] = useState<Subject | null>(null)

  const usedColors = subjects.map(s => s.color)

  const handleCreate = async (form: FormState) => {
    await createSubject.mutateAsync({
      name: form.name.trim(),
      isArts: form.isArts,
      color: form.color,
      specializedRoomId: form.specializedRoomId || null,
    })
    setModalOpen(false)
  }

  const handleUpdate = async (form: FormState) => {
    if (!editingSubject) return
    await updateSubject.mutateAsync({
      id: editingSubject.id,
      data: {
        name: form.name.trim(),
        isArts: form.isArts,
        color: form.color,
        specializedRoomId: form.specializedRoomId || null,
      },
    })
    setEditingSubject(null)
  }

  const handleDelete = async () => {
    if (!deletingSubject) return
    await deleteSubject.mutateAsync(deletingSubject.id)
    setDeletingSubject(null)
  }

  const openEdit = (subject: Subject) => {
    setEditingSubject(subject)
  }

  if (isLoading) {
    return (
      <AppShell title="Subjects">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Subjects"
      actions={
        <Button onClick={() => setModalOpen(true)}>+ New Subject</Button>
      }
    >
      {subjects.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No subjects yet"
          description="Add subjects to use in lesson planning."
          action={
            <Button onClick={() => setModalOpen(true)}>+ New Subject</Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {subjects.map(subject => (
            <div
              key={subject.id}
              className="flex items-center gap-4 px-4 py-3 rounded-lg border"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              {/* Color swatch */}
              <div
                className="w-1 h-8 rounded-full shrink-0"
                style={{ background: subject.color }}
              />
              {/* Name */}
              <span
                className="flex-1 text-[14px] font-medium text-[var(--text-1)] hebrew"
              >
                {subject.name}
              </span>
              {/* Tags */}
              {subject.isArts && <Badge variant="accent">Arts</Badge>}
              {subject.specializedRoomId && (
                <Badge variant="neutral">Specialized Room</Badge>
              )}
              {/* Actions */}
              <div className="flex gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(subject)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingSubject(subject)}
                  className="text-red-500 hover:text-red-600"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Subject"
      >
        <SubjectForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => setModalOpen(false)}
          loading={createSubject.isPending}
          usedColors={usedColors}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editingSubject}
        onClose={() => setEditingSubject(null)}
        title="Edit Subject"
      >
        {editingSubject && (
          <SubjectForm
            initial={{
              name: editingSubject.name,
              isArts: editingSubject.isArts,
              color: editingSubject.color,
              specializedRoomId: editingSubject.specializedRoomId ?? '',
            }}
            onSave={handleUpdate}
            onCancel={() => setEditingSubject(null)}
            loading={updateSubject.isPending}
            usedColors={usedColors.filter(c => c !== editingSubject.color)}
          />
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deletingSubject}
        onClose={() => setDeletingSubject(null)}
        onConfirm={handleDelete}
        title={`Delete "${deletingSubject?.name}"?`}
        description="This will remove the subject from all associated lessons. This cannot be undone."
        confirmLabel="Delete Subject"
        danger
        loading={deleteSubject.isPending}
      />
    </AppShell>
  )
}
