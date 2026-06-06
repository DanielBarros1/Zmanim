/**
 * AdminLogsPage — server log viewer for root users.
 *
 * Shows the last N lines from the server's in-memory log buffer
 * (stdout + stderr, including auto-scheduler worker thread output).
 *
 * Controls:
 *   - Text filter (substring match)
 *   - Stream filter (all / stdout / stderr)
 *   - Lines count (100 / 200 / 500)
 *   - Auto-refresh toggle (every 5 s)
 *   - Manual Refresh button
 *
 * Logs are ephemeral — buffer resets on container restart.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLogs } from '../../api/logs'
import type { ServerLogEntry } from '../../api/logs'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTs(iso: string): string {
  // "2026-06-06T14:23:01.123Z" → "14:23:01.123"
  try {
    const d = new Date(iso)
    const hh  = String(d.getUTCHours()).padStart(2, '0')
    const mm  = String(d.getUTCMinutes()).padStart(2, '0')
    const ss  = String(d.getUTCSeconds()).padStart(2, '0')
    const ms  = String(d.getUTCMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  } catch {
    return iso
  }
}

function lineColor(entry: ServerLogEntry): string {
  if (entry.level === 'error') return '#f87171'  // red-400
  if (entry.msg.includes('[ERROR]') || entry.msg.toLowerCase().includes('error')) return '#fca5a5'
  if (entry.msg.includes('[WARN]')  || entry.msg.toLowerCase().includes('warn'))  return '#fb923c'
  if (entry.msg.includes('[AutoScheduler]')) return '#93c5fd'   // blue-300
  return '#94a3b8'  // slate-400 — default
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminLogsPage() {
  const [filter,      setFilter]      = useState('')
  const [level,       setLevel]       = useState<'all' | 'log' | 'error'>('all')
  const [lines,       setLines]       = useState(200)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [entries,     setEntries]     = useState<ServerLogEntry[]>([])
  const [total,       setTotal]       = useState(0)
  const [lastFetch,   setLastFetch]   = useState<Date | null>(null)

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const [pinBottom, setPinBottom] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchLogs({
        lines,
        filter:  filter.trim() || undefined,
        level:   level === 'all' ? undefined : level,
      })
      setEntries(data.entries)
      setTotal(data.bufferedTotal)
      setLastFetch(new Date())
    } catch (err: any) {
      const msg = err?.response?.status === 403
        ? 'Access denied — root users only.'
        : 'Failed to fetch logs.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [filter, level, lines])

  // Initial load
  useEffect(() => { load() }, [load])

  // Auto-refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (autoRefresh) {
      timerRef.current = setInterval(load, 5000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoRefresh, load])

  // Pin to bottom when new entries arrive
  useEffect(() => {
    if (pinBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [entries, pinBottom])

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-4 px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div>
          <h1 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>
            🔍 Server Logs
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            In-memory buffer — last {total} entries since last restart
            {lastFetch && (
              <> · refreshed {lastFetch.toLocaleTimeString()}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[12px]"
            style={{ color: 'var(--text-2)' }}>
            <div
              className="relative w-8 h-4 rounded-full transition-colors"
              style={{ background: autoRefresh ? 'var(--accent)' : 'var(--border)' }}
              onClick={() => setAutoRefresh(v => !v)}
            >
              <div
                className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                style={{ transform: autoRefresh ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </div>
            Auto-refresh 5s
          </label>

          {/* Manual refresh */}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
            style={{
              background:  'var(--accent)',
              color:       'white',
              cursor:      loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex items-center gap-3 px-6 py-3 border-b shrink-0 flex-wrap"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {/* Text filter */}
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter (e.g. AutoScheduler)"
          className="rounded-md px-3 py-1.5 text-[12px] w-56"
          style={{
            background: 'var(--surface-2)',
            border:     '1px solid var(--border)',
            color:      'var(--text-1)',
            outline:    'none',
          }}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
        />

        {/* Stream filter */}
        <select
          value={level}
          onChange={e => setLevel(e.target.value as 'all' | 'log' | 'error')}
          className="rounded-md px-2 py-1.5 text-[12px]"
          style={{
            background: 'var(--surface-2)',
            border:     '1px solid var(--border)',
            color:      'var(--text-1)',
          }}
        >
          <option value="all">All streams</option>
          <option value="log">stdout only</option>
          <option value="error">stderr only</option>
        </select>

        {/* Lines */}
        <select
          value={lines}
          onChange={e => setLines(Number(e.target.value))}
          className="rounded-md px-2 py-1.5 text-[12px]"
          style={{
            background: 'var(--surface-2)',
            border:     '1px solid var(--border)',
            color:      'var(--text-1)',
          }}
        >
          <option value={100}>Last 100</option>
          <option value={200}>Last 200</option>
          <option value={500}>Last 500</option>
          <option value={1000}>Last 1000</option>
        </select>

        {/* Showing count */}
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {entries.length} line{entries.length !== 1 ? 's' : ''} shown
        </span>

        {/* Quick filter chips */}
        <div className="flex gap-1.5 ml-auto">
          {['AutoScheduler', 'Gate', 'ERROR', 'timeout'].map(chip => (
            <button
              key={chip}
              onClick={() => setFilter(chip)}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background:  filter === chip ? 'var(--accent-bg)' : 'var(--surface-2)',
                color:       filter === chip ? 'var(--accent-text)' : 'var(--text-3)',
                border:      '1px solid var(--border)',
              }}
            >
              {chip}
            </button>
          ))}
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="px-2 py-0.5 rounded text-[10px]"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              ✕ clear
            </button>
          )}
        </div>
      </div>

      {/* Log output */}
      <div
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed"
        style={{ background: '#0f172a' }}
        onScroll={e => {
          const el = e.currentTarget
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          setPinBottom(nearBottom)
        }}
      >
        {error ? (
          <p className="p-4 text-red-400">{error}</p>
        ) : entries.length === 0 && !loading ? (
          <p className="p-4 text-slate-500">No log entries match the current filter.</p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={i}
                  className="hover:bg-white/5 transition-colors"
                >
                  {/* Timestamp */}
                  <td
                    className="pl-4 pr-3 py-0.5 whitespace-nowrap align-top select-none"
                    style={{ color: '#334155', width: 90 }}
                  >
                    {formatTs(entry.ts)}
                  </td>
                  {/* Stream badge */}
                  <td className="pr-3 py-0.5 whitespace-nowrap align-top select-none w-12">
                    {entry.level === 'error' && (
                      <span className="text-[9px] px-1 rounded" style={{ background: '#450a0a', color: '#f87171' }}>
                        ERR
                      </span>
                    )}
                  </td>
                  {/* Message */}
                  <td
                    className="pr-4 py-0.5 break-all align-top"
                    style={{ color: lineColor(entry) }}
                  >
                    {entry.msg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer — pin toggle */}
      <div
        className="flex items-center justify-between px-6 py-2 border-t shrink-0 text-[11px]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-3)' }}
      >
        <span>⚠️ Logs are ephemeral — buffer resets on container restart</span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pinBottom}
            onChange={e => setPinBottom(e.target.checked)}
            className="w-3 h-3"
          />
          Pin to bottom
        </label>
      </div>
    </div>
  )
}
