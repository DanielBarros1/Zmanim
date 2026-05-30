/**
 * TeachersPage — manage the teacher roster.
 *
 * Teachers have:
 *   - name (Hebrew)
 *   - subjectIds (which subjects they can teach — multi-select from subject catalogue)
 *
 * The subject list is used in:
 *   - Lesson creation (only teachers who can teach that subject are offered)
 *   - Restriction creation (filters teacher-level restrictions)
 */

import { useState, useEffect } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Spinner } from '../../components/ui/Spinner'
import {
  useTeachers,
  useCreateTeacher,
  useUpdateTeacher,
  useDeleteTeacher,
  useBackfillTeacherSubjects,
} from '../../api/teachers'
import { useSubjects } from '../../api/subjects'
import type { Teacher } from '@zmanim/shared'

interface FormState {
  name: string
  subjectIds: string[]
}

const EMPTY_FORM: FormState = { name: '', subjectIds: [] }

function TeacherForm({
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
  const { data: subjects = [] } = useSubjects()

  const toggleSubject = (id: string) => {
    setForm(prev => ({
      ...prev,
      subjectIds: prev.subjectIds.includes(id)
        ? prev.subjectIds.filter(s => s !== id)
        : [...prev.subjectIds, id],
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Teacher name (Hebrew)"
        placeholder="יוסי כהן"
        value={form.name}
        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
        isHebrew
        required
        autoFocus
      />

      <div>
        <p className="text-[12px] font-medium text-[var(--text-2)] mb-2">
          Subjects taught
        </p>
        {subjects.length === 0 ? (
          <p className="text-[12px] text-[var(--text-3)]">
            No subjects defined yet. Add subjects first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subjects.map(subject => {
              const selected = form.subjectIds.includes(subject.id)
              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => toggleSubject(subject.id)}
                  className="px-3 py-1 rounded-full text-[12px] font-medium border transition-colors"
                  style={{
                    borderColor: selected ? subject.color : 'var(--border)',
                    background: selected ? subject.color + '20' : 'var(--surface)',
                    color: selected ? subject.color : 'var(--text-2)',
                  }}
                >
                  {subject.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

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
          Save Teacher
        </Button>
      </div>
    </form>
  )
}

export function TeachersPage() {
  const { data: teachers = [], isLoading } = useTeachers()
  const { data: subjects = [] } = useSubjects()
  const createTeacher = useCreateTeacher()
  const updateTeacher = useUpdateTeacher()
  const deleteTeacher = useDeleteTeacher()
  const backfill = useBackfillTeacherSubjects()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null)
  const [deletingTeacher, setDeletingTeacher] = useState<Teacher | null>(null)
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [createError, setCreateError] = useState<string>()
  const [editError, setEditError] = useState<string>()
  const [search, setSearch] = useState('')
  const [filterSubjectId, setFilterSubjectId] = useState('')

  // Backfill teacher-subject links from existing lessons on first mount
  useEffect(() => { backfill.mutate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))

  const handleCreate = async (form: FormState) => {
    setCreateError(undefined)
    try {
      await createTeacher.mutateAsync({ name: form.name.trim(), subjectIds: form.subjectIds })
      setModalOpen(false)
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to save teacher.')
    }
  }

  const handleUpdate = async (form: FormState) => {
    if (!editingTeacher) return
    setEditError(undefined)
    try {
      await updateTeacher.mutateAsync({
        id: editingTeacher.id,
        data: { name: form.name.trim(), subjectIds: form.subjectIds },
      })
      setEditingTeacher(null)
    } catch (err: any) {
      setEditError(err?.response?.data?.error ?? 'Failed to update teacher.')
    }
  }

  const handleDelete = async () => {
    if (!deletingTeacher) return
    setDeleteError(undefined)
    try {
      await deleteTeacher.mutateAsync(deletingTeacher.id)
      setDeletingTeacher(null)
      setDeleteError(undefined)
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error ?? 'Failed to delete teacher.')
    }
  }

  if (isLoading) {
    return (
      <AppShell title="Teachers">
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Teachers"
      actions={<Button onClick={() => setModalOpen(true)}>+ New Teacher</Button>}
    >
      {teachers.length === 0 ? (
        <EmptyState
          icon="👩‍🏫"
          title="No teachers yet"
          description="Add teachers before creating lesson plans."
          action={<Button onClick={() => setModalOpen(true)}>+ New Teacher</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="search"
              placeholder="Search teachers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-md px-3 py-1.5 text-[13px] w-56"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <select
              value={filterSubjectId}
              onChange={e => setFilterSubjectId(e.target.value)}
              className="rounded-md px-3 py-1.5 text-[13px]"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: filterSubjectId ? 'var(--accent)' : 'var(--text-3)' }}
            >
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        <div className="space-y-2">
          {teachers
            .filter(t =>
              t.name.toLowerCase().includes(search.toLowerCase()) &&
              (filterSubjectId === '' || t.subjectIds.includes(filterSubjectId))
            )
            .map(teacher => (
            <div
              key={teacher.id}
              className="flex items-center gap-4 px-4 py-3 rounded-lg border"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0"
                style={{ background: 'var(--accent)' }}
              >
                {teacher.name.charAt(0)}
              </div>
              <span className="flex-1 text-[14px] font-medium text-[var(--text-1)] hebrew">
                {teacher.name}
              </span>
              {/* Subject pills */}
              <div className="flex gap-1.5 flex-wrap max-w-xs">
                {teacher.subjectIds.slice(0, 4).map(sid => {
                  const sub = subjectMap[sid]
                  if (!sub) return null
                  return (
                    <span
                      key={sid}
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{
                        background: sub.color + '20',
                        color: sub.color,
                      }}
                    >
                      {sub.name}
                    </span>
                  )
                })}
                {teacher.subjectIds.length > 4 && (
                  <span className="text-[10px] text-[var(--text-3)]">
                    +{teacher.subjectIds.length - 4}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingTeacher(teacher)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingTeacher(teacher)}
                  className="text-red-500 hover:text-red-600"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setCreateError(undefined) }}
        title="New Teacher"
      >
        <TeacherForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => { setModalOpen(false); setCreateError(undefined) }}
          loading={createTeacher.isPending}
          error={createError}
        />
      </Modal>

      <Modal
        open={!!editingTeacher}
        onClose={() => { setEditingTeacher(null); setEditError(undefined) }}
        title="Edit Teacher"
      >
        {editingTeacher && (
          <TeacherForm
            initial={{
              name: editingTeacher.name,
              subjectIds: [...editingTeacher.subjectIds],
            }}
            onSave={handleUpdate}
            onCancel={() => { setEditingTeacher(null); setEditError(undefined) }}
            loading={updateTeacher.isPending}
            error={editError}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingTeacher}
        onClose={() => { setDeletingTeacher(null); setDeleteError(undefined) }}
        onConfirm={handleDelete}
        title={`Delete "${deletingTeacher?.name}"?`}
        description="All lessons and restrictions for this teacher will also be removed."
        confirmLabel="Delete Teacher"
        danger
        loading={deleteTeacher.isPending}
        error={deleteError}
      />
    </AppShell>
  )
}
