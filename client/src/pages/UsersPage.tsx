/**
 * UsersPage — User Management (/users)
 *
 * Only accessible by root users (email in ALLOWED_EMAILS env var).
 * Non-root users see a 403 message — the route and sidebar link are
 * conditionally rendered in App.tsx / Sidebar.tsx so they typically
 * won't reach this page, but the server enforces it regardless.
 *
 * Layout:
 *   - Info banner explaining root vs. invited
 *   - Invite form (email input + button)
 *   - User table: avatar | name/email | badge (Root/Pending) | invited by | date | revoke
 */

import { useState } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useCurrentUser } from '../api/auth'
import { useUsers, useInviteUser, useRevokeUser } from '../api/users'
import type { UserListItem } from '@zmanim/shared'

// ─── Sub-components ───────────────────────────────────────────

function UserAvatar({ item }: { item: UserListItem }) {
  if (item.picture) {
    return (
      <img
        src={item.picture}
        alt={item.name ?? item.email}
        className="w-8 h-8 rounded-full object-cover shrink-0"
        referrerPolicy="no-referrer"
      />
    )
  }
  const initials = item.name
    ? item.name.charAt(0).toUpperCase()
    : item.email.charAt(0).toUpperCase()
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
      style={{ background: 'var(--accent)' }}
    >
      {initials}
    </div>
  )
}

function StatusBadge({ item }: { item: UserListItem }) {
  if (item.isRoot) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
      >
        ★ Root
      </span>
    )
  }
  if (!item.userId) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
        style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
      >
        Pending
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ background: '#dcfce7', color: '#16a34a' }}
    >
      ✓ Active
    </span>
  )
}

function UserRow({
  item,
  currentEmail,
  onRevoke,
  revoking,
}: {
  item: UserListItem
  currentEmail: string
  onRevoke: (id: string) => void
  revoking: boolean
}) {
  const isSelf = item.email.toLowerCase() === currentEmail.toLowerCase()

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Avatar + name/email */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar item={item} />
          <div className="min-w-0">
            {item.name ? (
              <>
                <p className="text-[13px] font-medium text-[var(--text-1)] truncate">{item.name}</p>
                <p className="text-[11px] text-[var(--text-3)] truncate">{item.email}</p>
              </>
            ) : (
              <p className="text-[13px] text-[var(--text-2)] truncate">{item.email}</p>
            )}
          </div>
        </div>
      </td>

      {/* Status badge */}
      <td className="px-4 py-3">
        <StatusBadge item={item} />
      </td>

      {/* Invited by */}
      <td className="px-4 py-3 text-[12px] text-[var(--text-3)]">
        {item.isRoot ? (
          <span className="italic">via env var</span>
        ) : (
          item.invitedBy ?? '—'
        )}
      </td>

      {/* Date */}
      <td className="px-4 py-3 text-[12px] text-[var(--text-3)] whitespace-nowrap">
        {item.isRoot ? '—' : item.invitedAt
          ? new Date(item.invitedAt).toLocaleDateString()
          : '—'}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        {item.isRoot ? (
          <span className="text-[11px] text-[var(--text-3)] italic">Managed via env</span>
        ) : isSelf ? (
          <span className="text-[11px] text-[var(--text-3)] italic">You</span>
        ) : (
          <Button
            variant="danger"
            size="sm"
            onClick={() => item.allowedEmailId && onRevoke(item.allowedEmailId)}
            disabled={revoking}
          >
            Revoke
          </Button>
        )}
      </td>
    </tr>
  )
}

// ─── Invite form ──────────────────────────────────────────────

function InviteForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()
  const invite = useInviteUser()

  const handleInvite = async () => {
    setError(undefined)
    setSuccess(undefined)
    if (!email.trim()) {
      setError('Please enter an email address.')
      return
    }
    try {
      await invite.mutateAsync(email.trim())
      setSuccess(`${email.trim()} has been invited.`)
      setEmail('')
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to invite user.')
    }
  }

  return (
    <div
      className="rounded-xl border p-4 mb-6"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <h3 className="text-[13px] font-semibold text-[var(--text-1)] mb-3">Invite a User</h3>
      <p className="text-[12px] text-[var(--text-3)] mb-3">
        Enter a Google account email. The user will be able to log in once invited.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(undefined); setSuccess(undefined) }}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          className="flex-1 rounded-lg border px-3 py-2 text-[13px] text-[var(--text-1)] bg-[var(--surface)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
          style={{ borderColor: error ? '#ef4444' : 'var(--border)' }}
          disabled={invite.isPending}
        />
        <Button onClick={handleInvite} disabled={invite.isPending}>
          {invite.isPending ? 'Inviting…' : 'Invite'}
        </Button>
      </div>
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
      {success && <p className="text-[12px] text-green-600 mt-2">✓ {success}</p>}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export function UsersPage() {
  const { data: currentUser } = useCurrentUser()
  const { data: users = [], isLoading } = useUsers()
  const revoke = useRevokeUser()
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Guard: non-root users shouldn't reach this page but handle gracefully
  if (currentUser && !currentUser.isRoot) {
    return (
      <AppShell title="User Management">
        <div
          className="rounded-xl border border-dashed p-12 text-center"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-[var(--text-3)] text-sm">
            You need root access to manage users.
          </p>
        </div>
      </AppShell>
    )
  }

  const handleRevoke = async (allowedEmailId: string) => {
    if (!confirm('Remove this user\'s access? They will not be able to log in again.')) return
    setRevokingId(allowedEmailId)
    try {
      await revoke.mutateAsync(allowedEmailId)
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to revoke access.')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <AppShell title="User Management">
      {/* Info banner */}
      <div
        className="rounded-xl border p-4 mb-6 text-[12px]"
        style={{ background: 'var(--accent-bg)', borderColor: 'var(--accent)', color: 'var(--text-2)' }}
      >
        <p className="font-semibold text-[var(--text-1)] mb-1">About access levels</p>
        <p>
          <strong>Root users</strong> are defined in the <code className="font-mono bg-black/10 px-1 rounded">ALLOWED_EMAILS</code> server
          env var. They can manage who can log in. To add or remove a root user, edit the env file on the server.
        </p>
        <p className="mt-1">
          <strong>Invited users</strong> are added here. They can log in but cannot manage other users.
          Revoking access removes their invite — their current session stays active until they next try to log in.
        </p>
      </div>

      {/* Invite form */}
      <InviteForm />

      {/* User table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
        >
          <h2 className="text-[13px] font-semibold text-[var(--text-1)]">
            {isLoading ? 'Users' : `Users (${users.length})`}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 flex justify-center"><CenteredSpinner /></div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-[var(--text-3)]">
            No users yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase text-[var(--text-3)]">
                    User
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase text-[var(--text-3)]">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase text-[var(--text-3)]">
                    Invited By
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase text-[var(--text-3)]">
                    Date
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase text-[var(--text-3)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ background: 'var(--surface)' }}>
                {users.map(item => (
                  <UserRow
                    key={item.allowedEmailId ?? `root:${item.email}`}
                    item={item}
                    currentEmail={currentUser?.email ?? ''}
                    onRevoke={handleRevoke}
                    revoking={revokingId === item.allowedEmailId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
