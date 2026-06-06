/**
 * logBuffer — captures ALL server output (main thread + worker threads) into a
 * fixed-size in-memory circular buffer so root users can inspect recent logs
 * via GET /api/logs without needing SSH access.
 *
 * Implementation:
 *   We intercept process.stdout.write and process.stderr.write (not console.log)
 *   because the auto-scheduler runs in a Worker thread whose console object is
 *   separate from the main thread's, but both threads share the same underlying
 *   process.stdout / process.stderr streams.  Patching the streams captures
 *   everything: Express request logs, AS restart logs, Gate errors, etc.
 *
 * Call installLogCapture() once at app startup (before any output is produced).
 * The buffer is ephemeral — it resets on container restart.
 */

const MAX_ENTRIES = 1_000

export interface LogEntry {
  ts:    string           // ISO-8601
  level: 'log' | 'error' // stdout = log, stderr = error
  msg:   string           // one trimmed line of output
}

const buffer: LogEntry[] = []
let installed = false

// ── Internal helpers ──────────────────────────────────────────────────────────

function captureChunk(chunk: unknown, level: 'log' | 'error'): void {
  let text: string
  if (typeof chunk === 'string') {
    text = chunk
  } else if (Buffer.isBuffer(chunk)) {
    text = chunk.toString('utf8')
  } else if (chunk instanceof Uint8Array) {
    text = Buffer.from(chunk).toString('utf8')
  } else {
    return
  }

  // One write may contain multiple newline-delimited lines
  const lines = text.split('\n')
  const ts = new Date().toISOString()
  for (const raw of lines) {
    const msg = raw.replace(/\r$/, '')
    if (!msg.trim()) continue
    buffer.push({ ts, level, msg })
    if (buffer.length > MAX_ENTRIES) buffer.shift()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Patch process.stdout and process.stderr to capture all output.
 * Safe to call multiple times — only installs once.
 */
export function installLogCapture(): void {
  if (installed) return
  installed = true

  const origOut = process.stdout.write.bind(process.stdout) as (...a: any[]) => boolean
  const origErr = process.stderr.write.bind(process.stderr) as (...a: any[]) => boolean

  ;(process.stdout as any).write = function (...args: any[]): boolean {
    captureChunk(args[0], 'log')
    return origOut(...args)
  }

  ;(process.stderr as any).write = function (...args: any[]): boolean {
    captureChunk(args[0], 'error')
    return origErr(...args)
  }
}

export interface LogQuery {
  /** Tail the last N lines after filtering. Default 200, max 1000. */
  lines?:  number
  /** Case-insensitive substring filter applied to the msg field. */
  filter?: string
  /** Only return entries from stdout (log) or stderr (error). */
  level?:  'log' | 'error'
}

/** Return a filtered, tailed slice of the buffer. Non-destructive. */
export function getRecentLogs(opts: LogQuery = {}): LogEntry[] {
  let result = buffer.slice() // shallow copy — never mutate the live buffer

  if (opts.level) {
    result = result.filter(e => e.level === opts.level)
  }
  if (opts.filter) {
    const lc = opts.filter.toLowerCase()
    result = result.filter(e => e.msg.toLowerCase().includes(lc))
  }

  const lines = Math.min(opts.lines ?? 200, MAX_ENTRIES)
  return result.slice(-lines)
}

/** Total entries currently in the buffer (before any filtering). */
export function getBufferSize(): number {
  return buffer.length
}
