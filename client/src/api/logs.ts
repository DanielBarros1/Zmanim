/**
 * Server log viewer API.
 *
 * fetchLogs() calls GET /api/logs (root-only) and returns recent log entries
 * from the server's in-memory circular buffer.  Logs are ephemeral — they
 * reset on container restart.
 */

import apiClient from './client'

export interface ServerLogEntry {
  ts:    string           // ISO-8601 timestamp
  level: 'log' | 'error' // stdout vs stderr
  msg:   string           // one trimmed line
}

export interface FetchLogsParams {
  /** Tail the last N lines (after filtering). Default 200. */
  lines?:  number
  /** Case-insensitive substring filter. */
  filter?: string
  /** Only return stdout ('log') or stderr ('error') entries. */
  level?:  'log' | 'error'
}

export interface LogsResponse {
  entries:       ServerLogEntry[]
  bufferedTotal: number
}

export async function fetchLogs(params: FetchLogsParams = {}): Promise<LogsResponse> {
  const search = new URLSearchParams()
  if (params.lines  != null) search.set('lines',  String(params.lines))
  if (params.filter)         search.set('filter', params.filter)
  if (params.level)          search.set('level',  params.level)
  const qs = search.toString() ? `?${search.toString()}` : ''
  const res = await apiClient.get<LogsResponse>(`/api/logs${qs}`)
  return res.data
}
