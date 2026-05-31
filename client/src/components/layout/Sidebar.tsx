/**
 * Sidebar — left navigation column.
 *
 * Layout:
 *   - Logo / app name at the top
 *   - Nav sections: "Schedules", "Views", "Definitions"
 *   - Collapse toggle button (bottom of nav area)
 *   - User avatar + name + logout (footer)
 *
 * Collapse: width shrinks to 52px; nav shows icons only with title tooltips.
 * State persisted to localStorage via uiStore.
 *
 * Active item: accent background + accent text.
 * Inactive item: text-2, ghost hover.
 */

import { NavLink, useNavigate } from 'react-router-dom'
import { useCurrentUser, useLogout } from '../../api/auth'
import { useUIStore } from '../../store/uiStore'

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
  { to: '/import',                   label: 'Import XLSX',    icon: '📥' },
]

const SCHEDULE_NAV: NavItem[] = [
  { to: '/',          label: 'Home',          icon: '🏠' },
  { to: '/schedules', label: 'All Schedules', icon: '🗓️' },
]

/** Shown only to root users (email in ALLOWED_EMAILS env). */
const ADMIN_NAV: NavItem[] = [
  { to: '/users', label: 'Users', icon: '👥' },
]

const VIEWS_NAV: NavItem[] = [
  { to: '/views/teacher',  label: 'Teacher View',  icon: '👤' },
  { to: '/views/grade',    label: 'Grade View',    icon: '🎓' },
  { to: '/views/compact',  label: 'Compact',       icon: '🖨️' },
]

function NavSection({
  label,
  items,
  collapsed,
}: {
  label: string
  items: NavItem[]
  collapsed: boolean
}) {
  return (
    <div className="mb-5">
      {!collapsed && (
        <p
          className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em]"
          style={{ color: 'var(--text-3)' }}
        >
          {label}
        </p>
      )}
      {collapsed && <div className="mb-1 h-px mx-2" style={{ background: 'var(--border)' }} />}
      <ul className="space-y-0.5">
        {items.map(item => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                [
                  'flex items-center rounded-md text-[13px] font-medium transition-colors',
                  collapsed ? 'justify-center py-2 px-0 mx-1' : 'gap-2.5 px-3 py-2',
                  isActive
                    ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]',
                ].join(' ')
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {!collapsed && item.label}
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
  const { sidebarCollapsed, toggleSidebar } = useUIStore()

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login'),
    })
  }

  return (
    <aside
      className="flex flex-col shrink-0 h-full border-r overflow-hidden"
      style={{
        width: sidebarCollapsed ? 52 : 220,
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        transition: 'width 180ms ease',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 border-b overflow-hidden"
        style={{
          borderColor: 'var(--border)',
          height: 57,
          paddingLeft: sidebarCollapsed ? 0 : 16,
          paddingRight: sidebarCollapsed ? 0 : 16,
          justifyContent: sidebarCollapsed ? 'center' : undefined,
        }}
      >
        <span className="text-xl shrink-0">🕐</span>
        {!sidebarCollapsed && (
          <>
            <span
              className="text-[15px] font-bold tracking-tight whitespace-nowrap"
              style={{ color: 'var(--text-1)' }}
            >
              Zmanim
            </span>
            <span
              className="ml-auto text-[11px] font-medium whitespace-nowrap"
              style={{ color: 'var(--text-3)' }}
            >
              זמנים
            </span>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <NavSection label="Schedules" items={SCHEDULE_NAV} collapsed={sidebarCollapsed} />
        <NavSection label="Views" items={VIEWS_NAV} collapsed={sidebarCollapsed} />
        <NavSection label="Definitions" items={DEFINITIONS_NAV} collapsed={sidebarCollapsed} />
        {/* Admin section — only rendered for root users */}
        {user?.isRoot && (
          <NavSection label="Admin" items={ADMIN_NAV} collapsed={sidebarCollapsed} />
        )}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center border-t py-2 transition-colors hover:bg-[var(--surface-2)]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span
          className="text-[16px] font-medium select-none"
          style={{ transform: sidebarCollapsed ? 'scaleX(-1)' : undefined }}
        >
          ‹‹
        </span>
      </button>

      {/* User footer */}
      {user && (
        <div
          className="border-t overflow-hidden"
          style={{ borderColor: 'var(--border)', padding: sidebarCollapsed ? '10px 0' : '10px 12px' }}
        >
          <div
            className="flex items-center gap-2"
            style={{ justifyContent: sidebarCollapsed ? 'center' : undefined }}
          >
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-7 h-7 rounded-full shrink-0 object-cover"
                title={sidebarCollapsed ? user.name : undefined}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                style={{ background: 'var(--accent)' }}
                title={sidebarCollapsed ? user.name : undefined}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[var(--text-1)] truncate">
                  {user.name}
                </p>
                <p className="text-[10px] text-[var(--text-3)] truncate">{user.email}</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={handleLogout}
              className="w-full text-left text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors mt-2"
            >
              Sign out →
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
