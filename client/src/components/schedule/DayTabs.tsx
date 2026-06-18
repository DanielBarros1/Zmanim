/**
 * DayTabs — horizontal day selector below the stats bar.
 *
 * Shows Sun–Thu tabs. Clicking a tab updates the active day in the UI store.
 * The active day controls which column of the schedule grid is rendered
 * (in the "day view" mode — the grid also supports a full week view).
 *
 * Each tab shows:
 *   - Day name
 *   - Count of placed lessons for that day (out of max possible)
 */

import { Day, DAY_ORDER } from '@zmanim/shared'
import type { ScheduleEntry } from '@zmanim/shared'
import { useUIStore } from '../../store/uiStore'

const DAY_LABEL: Record<Day, string> = {
  [Day.SUNDAY]: 'Sunday',
  [Day.MONDAY]: 'Monday',
  [Day.TUESDAY]: 'Tuesday',
  [Day.WEDNESDAY]: 'Wednesday',
  [Day.THURSDAY]: 'Thursday',
}

const DAY_SHORT: Record<Day, string> = {
  [Day.SUNDAY]: 'Sun',
  [Day.MONDAY]: 'Mon',
  [Day.TUESDAY]: 'Tue',
  [Day.WEDNESDAY]: 'Wed',
  [Day.THURSDAY]: 'Thu',
}

interface DayTabsProps {
  entries: ScheduleEntry[]
  /** Max lessons per day = total lessons × (slots used that day / total slots).
   * Simple heuristic: just show the count placed. */
  workDays: Day[]
}

export function DayTabs({ entries, workDays }: DayTabsProps) {
  const { activeDay, setActiveDay } = useUIStore()

  const countByDay = Object.fromEntries(
    DAY_ORDER.map(d => [d, entries.filter(e => e.day === d).length]),
  )

  const days = DAY_ORDER.filter(d => workDays.includes(d))

  return (
    <div
      className="flex items-center gap-2 px-6 py-3 border-b flex-shrink-0 overflow-x-auto"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {days.map(day => {
        const isActive = day === activeDay
        const count = countByDay[day] ?? 0
        return (
          <button
            key={day}
            onClick={() => setActiveDay(day)}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all whitespace-nowrap"
            style={{
              background: isActive ? 'var(--accent)' : 'var(--surface-2)',
              color: isActive ? '#fff' : 'var(--text-1)',
              border: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              fontWeight: isActive ? '700' : '600',
              fontSize: '14px',
            }}
            aria-pressed={isActive}
            title={DAY_LABEL[day]}
          >
            <span>{DAY_SHORT[day]}</span>
            {count > 0 && (
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.3)' : 'var(--accent)',
                  color: isActive ? '#fff' : '#fff',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
