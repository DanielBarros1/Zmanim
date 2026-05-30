/**
 * ConfigPage — School configuration.
 *
 * Edits the single SchoolConfig record:
 *   - Day start time
 *   - Lesson duration (minutes)
 *   - Slots per day
 *   - Recesses (after slot N, duration M minutes)
 *   - Work days (Sun–Thu checkboxes)
 *
 * Changes are saved on submit. The config is used by:
 *   - The grid (calculates displayed times)
 *   - The evaluator (validates slot counts)
 *   - The auto-scheduler (respects work day constraints)
 */

import { useState, useEffect } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Checkbox } from '../../components/ui/Checkbox'
import { Spinner } from '../../components/ui/Spinner'
import { useConfig, useUpdateConfig } from '../../api/config'
import { Day } from '@zmanim/shared'
import type { Recess, SchoolConfig } from '@zmanim/shared'

const ALL_DAYS: Day[] = [Day.SUNDAY, Day.MONDAY, Day.TUESDAY, Day.WEDNESDAY, Day.THURSDAY]
const DAY_LABEL: Record<Day, string> = {
  [Day.SUNDAY]: 'Sunday',
  [Day.MONDAY]: 'Monday',
  [Day.TUESDAY]: 'Tuesday',
  [Day.WEDNESDAY]: 'Wednesday',
  [Day.THURSDAY]: 'Thursday',
}

function computeSlotTimes(
  dayStartTime: string,
  lessonDuration: number,
  slotsPerDay: number,
  recesses: Recess[],
): string[] {
  const [h, m] = dayStartTime.split(':').map(Number)
  let totalMinutes = h * 60 + m
  const times: string[] = []

  for (let slot = 1; slot <= slotsPerDay; slot++) {
    const hh = Math.floor(totalMinutes / 60)
    const mm = totalMinutes % 60
    times.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
    totalMinutes += lessonDuration
    const recess = recesses.find(r => r.afterSlot === slot)
    if (recess) totalMinutes += recess.durationMinutes
  }
  return times
}

export function ConfigPage() {
  const { data: config, isLoading } = useConfig()
  const updateConfig = useUpdateConfig()

  const [form, setForm] = useState<Partial<SchoolConfig> & { recesses: Recess[] }>({
    dayStartTime: '08:00',
    lessonDuration: 75,
    slotsPerDay: 4,
    recesses: [],
    workDays: [Day.SUNDAY, Day.MONDAY, Day.TUESDAY, Day.WEDNESDAY, Day.THURSDAY],
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) {
      setForm({
        dayStartTime: config.dayStartTime,
        lessonDuration: config.lessonDuration,
        slotsPerDay: config.slotsPerDay,
        recesses: config.recesses ?? [],
        workDays: config.workDays ?? [],
      })
    }
  }, [config])

  const slotTimes = computeSlotTimes(
    form.dayStartTime ?? '08:00',
    form.lessonDuration ?? 75,
    form.slotsPerDay ?? 4,
    form.recesses ?? [],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateConfig.mutateAsync(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleDay = (day: Day) => {
    setForm(prev => ({
      ...prev,
      workDays: prev.workDays?.includes(day)
        ? prev.workDays.filter(d => d !== day)
        : [...(prev.workDays ?? []), day],
    }))
  }

  const updateRecess = (idx: number, field: keyof Recess, value: number) => {
    setForm(prev => {
      const recesses = [...(prev.recesses ?? [])]
      recesses[idx] = { ...recesses[idx], [field]: value }
      return { ...prev, recesses }
    })
  }

  const addRecess = () => {
    setForm(prev => ({
      ...prev,
      recesses: [...(prev.recesses ?? []), { afterSlot: 1, durationMinutes: 10 }],
    }))
  }

  const removeRecess = (idx: number) => {
    setForm(prev => ({
      ...prev,
      recesses: (prev.recesses ?? []).filter((_, i) => i !== idx),
    }))
  }

  if (isLoading) {
    return (
      <AppShell title="School Config">
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="School Config">
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">

        {/* ── Basic timing ── */}
        <section>
          <h2 className="text-[13px] font-semibold text-[var(--text-1)] mb-4 uppercase tracking-wide">
            Daily Schedule
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Day start time"
              type="time"
              value={form.dayStartTime ?? ''}
              onChange={e => setForm(p => ({ ...p, dayStartTime: e.target.value }))}
            />
            <Input
              label="Lesson duration (min)"
              type="number"
              min={30}
              max={120}
              value={form.lessonDuration ?? ''}
              onChange={e =>
                setForm(p => ({ ...p, lessonDuration: Number(e.target.value) || 75 }))
              }
            />
            <Input
              label="Slots per day"
              type="number"
              min={1}
              max={8}
              value={form.slotsPerDay ?? ''}
              onChange={e =>
                setForm(p => ({ ...p, slotsPerDay: Number(e.target.value) || 4 }))
              }
            />
          </div>

          {/* Preview slot times */}
          <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">
              Slot start times (preview)
            </p>
            <div className="flex gap-3 flex-wrap">
              {slotTimes.map((time, i) => (
                <div key={i} className="text-center">
                  <p className="text-[10px] text-[var(--text-3)]">Slot {i + 1}</p>
                  <p className="text-[14px] font-mono font-medium text-[var(--text-1)]">{time}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Recesses ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-[var(--text-1)] uppercase tracking-wide">
              Recesses
            </h2>
            <Button type="button" variant="secondary" size="sm" onClick={addRecess}>
              + Add Recess
            </Button>
          </div>
          {(form.recesses ?? []).length === 0 && (
            <p className="text-[12px] text-[var(--text-3)]">No recesses configured.</p>
          )}
          <div className="space-y-2">
            {(form.recesses ?? []).map((recess, idx) => (
              <div
                key={idx}
                className="flex items-end gap-3 p-3 rounded-lg"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <Input
                  label="After slot"
                  type="number"
                  min={1}
                  max={form.slotsPerDay ?? 4}
                  value={recess.afterSlot}
                  onChange={e => updateRecess(idx, 'afterSlot', Number(e.target.value) || 1)}
                  className="w-28"
                />
                <Input
                  label="Duration (min)"
                  type="number"
                  min={5}
                  max={60}
                  value={recess.durationMinutes}
                  onChange={e =>
                    updateRecess(idx, 'durationMinutes', Number(e.target.value) || 10)
                  }
                  className="w-32"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRecess(idx)}
                  className="text-red-500 hover:text-red-600 mb-0.5"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Work days ── */}
        <section>
          <h2 className="text-[13px] font-semibold text-[var(--text-1)] mb-4 uppercase tracking-wide">
            Work Days
          </h2>
          <div className="flex gap-4 flex-wrap">
            {ALL_DAYS.map(day => (
              <Checkbox
                key={day}
                label={DAY_LABEL[day]}
                checked={(form.workDays ?? []).includes(day)}
                onChange={() => toggleDay(day)}
              />
            ))}
          </div>
        </section>

        {/* ── Save ── */}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={updateConfig.isPending}>
            Save Config
          </Button>
          {saved && (
            <span className="text-[12px] text-[var(--ok-text)]">✓ Saved</span>
          )}
          {updateConfig.isError && (
            <span className="text-[12px] text-red-500">Failed to save. Try again.</span>
          )}
        </div>
      </form>
    </AppShell>
  )
}
