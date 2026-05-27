/**
 * Sidebar — fixed 220px left column with navigation.
 *
 * Layout:
 *   - Logo / app name at the top
 *   - Nav sections: "Definitions" and "Schedules"
 *   - Bottom: user avatar + name + logout
 *
 * Active item: accent background + accent text.
 * Inactive item: text-2, ghost hover.
 */

import { NavLink, useNavigate } from 'react-router-dom'
import { useCurrentUser, useLogout } from '../../api/auth'

interface NavItem {
  to: string
  label: string
  icon: string
}

const DEFINITIONS_NAV: NavItem[] = [
  { to: '/definitions/config',       label: 'School Config',  icon: '⚙️' },
  { to: '/definitions/subjects',     label: 'Subjects',       icon: '📚' },
  { to: '/definitions/rooms',        label: 'Rooms',          icon: '🏫' },
  { to: '/definitions/teachers',     label: 'Teachers',       icon: '👩‍🏫' },
  { to: '/definitions/lessons',      label: 'Lessons',        icon: '📋' },
  { to: '/definitions/restrictions', label: 'Restrictions',   icon: '🔒' },
]

const SCHEDULE_NAV: NavItem[] = [
  { to: '/', label: 'All Schedules', icon: '🗓️' },
]

const VIEWS_NAV: NavItem[] = [
  { to: '/views/teacher',  label: 'Teacher View',  icon: '👤' },
  { to: '/views/grade',    label: 'Grade View',    icon: '🎓' },
  { to: '/views/compact',  label: 'Compact',       icon: '🖨️' },
]

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mb-5">
      <p
        className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map(item => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]',
                ].join(' ')
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Sidebar() {
  const { data: user } = useCurrentUser()
  const logout = useLogout()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login'),
    })
  }

  return (
    <aside
      className="flex flex-col shrink-0 h-full border-r"
      style={{
        width: 220,
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-4 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-xl">🕐</span>
        <span
          className="text-[15px] font-bold tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          Zmanim
        </span>
        <span
          className="ml-auto text-[11px] font-medium"
          style={{ color: 'var(--text-3)' }}
        >
          זמנים
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <NavSection label="Schedules" items={SCHEDULE_NAV} />
        <NavSection label="Views" items={VIEWS_NAV} />
        <NavSection label="Definitions" items={DEFINITIONS_NAV} />
      </nav>

      {/* User footer */}
      {user && (
        <div
          className="px-3 py-3 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-[var(--text-1)] truncate">
                {user.name}
              </p>
              <p className="text-[10px] text-[var(--text-3)] truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            Sign out →
          </button>
        </div>
      )}
    </aside>
  )
}
