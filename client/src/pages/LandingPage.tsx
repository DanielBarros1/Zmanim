/**
 * LandingPage — app home screen.
 *
 * Two sections:
 *   1. Stats row — at-a-glance counts from definitions (classes, teachers,
 *      subjects, rooms, lessons) plus placement % and violation summary
 *      for the currently displayed schedule.
 *   2. Schedule preview — the compact class×slot table (same layout as
 *      CompactViewPage) with a schedule selector so the user can swap
 *      between drafts without leaving home.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useGrades, useClasses } from '../api/grades'
import { useSubjects } from '../api/subjects'
import { useRooms } from '../api/rooms'
import { useTeachers } from '../api/teachers'
import { useLessons } from '../api/lessons'
import { useSchedules, useEntries, useEvaluation } from '../api/schedules'
import { useConfig } from '../api/config'
import { DAY_ORDER, ScheduleState } from '@zmanim/shared'
import type { Day } from '@zmanim/shared'

const DAY_SHORT: Record<Day, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
}

function StatCard({
  icon,
  value,
  label,
  accent,
}: {
  icon: string
  value: number | string
  label: string
  accent?: boolean
}) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col items-center gap-1"
      style={{
        background: accent ? 'var(--accent-bg)' : 'var(--surface)',
        borderColor: accent ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[22px] font-bold text-[var(--text-1)] tabular-nums">{value}</span>
      <span className="text-[10px] text-[var(--text-3)] text-center leading-tight">{label}</span>
    </div>
  )
}

function ViolationStat({ scheduleId }: { scheduleId: string }) {
  const { data: evaluation } = useEvaluation(scheduleId)
  if (!evaluation) return null

  const { counts } = evaluation
  const total = counts.total
  const icon = counts.nonNegotiable > 0 ? '⛔' : counts.important > 0 ? '⚠️' : '✅'
  const label = counts.nonNegotiable > 0
    ? `${counts.nonNegotiable} critical`
    : counts.important > 0
    ? `${counts.important} warnings`
    : 'No violations'

  return (
    <StatCard
      icon={icon}
      value={total === 0 ? 'Clean' : total}
      label={label}
      accent={counts.nonNegotiable > 0}
    />
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const { data: grades = [] } = useGrades()
  const { data: classes = [] } = useClasses()
  const { data: subjects = [] } = useSubjects()
  const { data: rooms = [] } = useRooms()
  const { data: teachers = [] } = useTeachers()
  const { data: lessons = [] } = useLessons()
  const { data: schedules = [], isLoading: schedulesLoading } = useSchedules()
  const { data: config } = useConfig()

  const [selectedId, setSelectedId] = useState('')

  const publishedSchedule = schedules.find(s => s.state === ScheduleState.PUBLISHED)
  const scheduleId = selectedId || publishedSchedule?.id || schedules[0]?.id || ''
  const selectedSchedule = schedules.find(s => s.id === scheduleId)

  const { data: entries = [], isLoading: entriesLoading } = useEntries(scheduleId)

  const workDays = (config?.workDays ?? DAY_ORDER) as Day[]
  const slots = config ? Array.from({ length: config.slotsPerDay }, (_, i) => i + 1) : []

  const sortedGrades = [...grades].sort((a, b) => a.number - b.number)
  const gradeClasses = sortedGrades.map(grade => ({
    grade,
    classes: classes
      .filter(c => c.gradeId === grade.id)
      .sort((a, b) => a.section.localeCompare(b.section)),
  }))

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]))

  const cellMap: Record<string, Record<string, Record<number, { color: string; name: string }>>> = {}
  for (const entry of entries) {
    const lesson = lessonMap[entry.lessonId]
    if (!lesson) continue
    const subject = subjectMap[lesson.subjectId]
    if (!subject) continue
    for (const classId of lesson.classIds) {
      if (!cellMap[classId]) cellMap[classId] = {}
      if (!cellMap[classId][entry.day]) cellMap[classId][entry.day] = {}
      cellMap[classId][entry.day][entry.slot] = { color: subject.color, name: subject.name }
    }
  }

  const placementPct =
    selectedSchedule && selectedSchedule.totalRequired > 0
      ? Math.round((selectedSchedule.totalPlaced / selectedSchedule.totalRequired) * 100)
      : null

  return (
    <AppShell title="Home">
      {/*
       * Stats: full-width grid. Cards stretch evenly across the entire
       * content area regardless of how many there are (5–7 depending on
       * which conditional cards render). These are deliberately NOT inside
       * the table's centering wrapper — stat cards are wider than the table
       * on most screens and would break the centering math.
       */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))' }}
      >
        <StatCard icon="🎓" value={classes.length} label="Classes" />
        <StatCard icon="👩‍🏫" value={teachers.length} label="Teachers" />
        <StatCard icon="📚" value={subjects.length} label="Subjects" />
        <StatCard icon="🏫" value={rooms.length} label="Rooms" />
        <StatCard icon="📋" value={lessons.length} label="Lessons" />
        {placementPct !== null && (
          <StatCard
            icon="📅"
            value={`${placementPct}%`}
            label="Placed"
            accent={placementPct === 100}
          />
        )}
        {scheduleId && <ViolationStat scheduleId={scheduleId} />}
      </div>

      {/*
       * Schedule card: `width: max-content` shrink-wraps to the table's
       * natural width (12 columns × 72px + label 52px ≈ 916px + borders).
       * `margin: 0 auto` centers it. The card header uses justify-between
       * inside that fixed width so the selector/button sit at the right edge
       * of the table — no wider, no narrower.
       */}
      {schedulesLoading ? (
        <CenteredSpinner />
      ) : schedules.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-12 text-center"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-[var(--text-3)] text-sm mb-4">
            No schedules yet. Create one to get started.
          </p>
          <Button onClick={() => navigate('/schedules')}>Go to Schedules →</Button>
        </div>
      ) : (
        /*
         * Centering wrapper: shrink-wraps to the table's natural width
         * (12 cols × 72px + 52px label ≈ 916px) and centers itself.
         * The card inside fills this width exactly — no empty space.
         */
        <div style={{ width: 'max-content', margin: '0 auto' }}>
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
          >
          {/* Card header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
          >
            <h2 className="text-[13px] font-semibold text-[var(--text-1)]">
              {publishedSchedule ? `★ ${publishedSchedule.name}` : 'Schedule Preview'}
            </h2>
            <div className="flex items-center gap-2">
              <Select
                value={scheduleId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-48 text-[12px]"
              >
                {schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.state === ScheduleState.PUBLISHED ? ' ★' : ''}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={() => navigate('/views/compact')}>
                Full View →
              </Button>
            </div>
          </div>

          {/* Table — no height cap; the card shrink-wraps the content */}
          <div style={{ background: 'var(--surface)' }}>
            {entriesLoading ? (
              <div className="p-8 flex justify-center"><CenteredSpinner /></div>
            ) : (
              <table className="border-collapse text-[11px]">
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th
                      className="text-left px-3 py-2 text-[10px] font-bold uppercase"
                      style={{
                        color: 'var(--text-3)',
                        borderBottom: '3px solid var(--border)',
                        borderRight: '3px solid var(--border)',
                        width: 52,
                        background: 'var(--surface-2)',
                      }}
                    >
                      Slot
                    </th>
                    {gradeClasses.flatMap(({ grade, classes: gc }, gradeIdx) =>
                      gc.map((cls, clsIdx) => (
                        <th
                          key={cls.id}
                          className="text-center px-1 py-2 text-[10px] font-bold"
                          style={{
                            color: 'var(--text-1)',
                            borderBottom: '3px solid var(--border)',
                            borderLeft: clsIdx === 0 ? '3px solid #4B5563' : undefined,
                            borderRight:
                              clsIdx === gc.length - 1
                                ? '3px solid #4B5563'
                                : '1px solid var(--border)',
                            minWidth: 72,
                            background:
                              gradeIdx % 2 === 0 ? 'var(--surface-2)' : 'var(--accent-bg)',
                          }}
                        >
                          {grade.number}{cls.section}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {workDays.flatMap((day, dayIdx) =>
                    slots.map(slot => {
                      const isFirstSlot = slot === 1
                      const isLastSlot = slot === slots[slots.length - 1]
                      return (
                        <tr
                          key={`${day}-${slot}`}
                          style={{
                            background:
                              dayIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                          }}
                        >
                          <td
                            className="px-3 py-1 font-bold text-[11px] text-center"
                            style={{
                              borderTop: isFirstSlot ? '3px solid #4B5563' : undefined,
                              borderBottom: isLastSlot
                                ? '3px solid #4B5563'
                                : '1px solid var(--border)',
                              borderRight: '3px solid var(--border)',
                              color: isFirstSlot ? 'var(--text-1)' : 'var(--text-3)',
                            }}
                          >
                            {isFirstSlot ? DAY_SHORT[day] : `S${slot}`}
                          </td>
                          {gradeClasses.flatMap(({ classes: gc }) =>
                            gc.map((cls, clsIdx) => {
                              const cell = cellMap[cls.id]?.[day]?.[slot]
                              return (
                                <td
                                  key={cls.id}
                                  className="px-0.5 py-0.5"
                                  style={{
                                    borderTop: isFirstSlot ? '3px solid #4B5563' : undefined,
                                    borderBottom: isLastSlot
                                      ? '3px solid #4B5563'
                                      : '1px solid var(--border)',
                                    borderLeft: clsIdx === 0 ? '3px solid #4B5563' : undefined,
                                    borderRight:
                                      clsIdx === gc.length - 1
                                        ? '3px solid #4B5563'
                                        : '1px solid var(--border)',
                                    height: 36,
                                    width: 72,
                                    overflow: 'hidden',
                                  }}
                                >
                                  {cell ? (
                                    <div
                                      className="w-full h-full rounded flex items-center justify-center text-white text-[9px] font-bold px-1"
                                      style={{
                                        background: cell.color,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                      title={cell.name}
                                    >
                                      {cell.name}
                                    </div>
                                  ) : (
                                    <div
                                      className="w-full h-full rounded"
                                      style={{ background: 'var(--empty-bg)' }}
                                    />
                                  )}
                                </td>
                              )
                            })
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/*
           * Legend — width:0 + min-width:100% is the key trick here.
           * In a `width:max-content` parent, percentage widths contribute 0
           * to the max-content calculation, so this element doesn't drive the
           * card any wider than the table. Once the card width is resolved
           * (to the table's ~916px), min-width:100% fills that width and
           * flex-wrap does its job normally.
           */}
          <div
            className="px-4 py-3 border-t flex flex-wrap gap-3"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-2)',
              width: 0,
              minWidth: '100%',
            }}
          >
            {subjects.map(s => (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className="text-[10px] text-[var(--text-2)] hebrew">{s.name}</span>
              </div>
            ))}
          </div>
          </div>{/* end card */}
        </div>
      )}
    </AppShell>
  )
}
