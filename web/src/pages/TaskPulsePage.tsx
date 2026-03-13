import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TaskPulseMessage, TaskPulseStateResponse } from '../lib/taskPulse'
import './TaskPulsePage.css'

const POLL_INTERVAL_MS = 10_000
const API_PATH = '/api/task-pulse/state'

function TaskPulsePage() {
  const [data, setData] = useState<TaskPulseStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskPulseMessage['displayStatus']>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)

    try {
      const response = await fetch(API_PATH, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`)
      }

      const payload = (await response.json()) as TaskPulseStateResponse
      setData(payload)
      setError(null)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unknown request error'
      setError(message)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [refresh])

  const sourceOptions = useMemo(() => {
    const options = new Set<string>()
    for (const message of data?.messages ?? []) {
      options.add(message.source)
    }
    return Array.from(options).sort()
  }, [data?.messages])

  const filteredMessages = useMemo(() => {
    const query = search.trim().toLowerCase()

    return (data?.messages ?? []).filter((message) => {
      if (statusFilter !== 'all' && message.displayStatus !== statusFilter) {
        return false
      }

      if (sourceFilter !== 'all' && message.source !== sourceFilter) {
        return false
      }

      if (query.length === 0) {
        return true
      }

      return [message.messageId, message.source, message.displayStatus]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [data?.messages, search, sourceFilter, statusFilter])

  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedMessageId(null)
      return
    }

    if (!selectedMessageId || !filteredMessages.some((message) => message.messageId === selectedMessageId)) {
      setSelectedMessageId(filteredMessages[0].messageId)
    }
  }, [filteredMessages, selectedMessageId])

  const selectedMessage = filteredMessages.find((message) => message.messageId === selectedMessageId) ?? null
  const deadCount = data?.messages.filter((message) => message.isDead).length ?? 0

  return (
    <main className="task-pulse-page">
      <section className="task-pulse-shell">
        <header className="task-pulse-header">
          <div>
            <p className="task-pulse-eyebrow">Operational Monitor</p>
            <h1>Task Pulse</h1>
            <p className="task-pulse-copy">Track whether inbound messages are active, waiting, done, or dead.</p>
          </div>
          <div className="task-pulse-header-actions">
            <p>Last update: {formatTimestamp(data?.generatedAt ?? null)}</p>
            <p>Watchdog: {formatTimestamp(data?.summary.watchdogUpdatedAt ?? null)}</p>
            <button type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing...' : 'Refresh now'}
            </button>
          </div>
        </header>

        <section className="task-pulse-cards" aria-label="Task pulse summary">
          <SummaryCard label="Active claim" value={data?.summary.activeClaim?.messageId ?? 'None'} />
          <SummaryCard label="Pending" value={String(data?.summary.pending ?? 0)} />
          <SummaryCard label="Done" value={String(data?.summary.done ?? 0)} />
          <SummaryCard label="Dead" value={String(deadCount)} />
        </section>

        <section className="task-pulse-filters" aria-label="Message filters">
          <input
            type="search"
            placeholder="Search message_id, source, or status"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="claimed">Claimed</option>
            <option value="working">Working</option>
            <option value="done">Done</option>
            <option value="dead">Dead</option>
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </section>

        <section className="task-pulse-content">
          <div className="task-pulse-list-pane">
            <div className="task-pulse-list-head">
              <h2>Messages</h2>
              <p>
                Showing {filteredMessages.length} of {data?.summary.tracked ?? 0}
              </p>
            </div>

            {filteredMessages.length === 0 ? (
              <p className="task-pulse-empty">No messages match the current filters.</p>
            ) : (
              <ul className="task-pulse-list" role="listbox" aria-label="Tracked messages">
                {filteredMessages.map((message) => (
                  <li key={message.messageId}>
                    <button
                      type="button"
                      className={message.messageId === selectedMessageId ? 'task-pulse-row is-selected' : 'task-pulse-row'}
                      onClick={() => setSelectedMessageId(message.messageId)}
                    >
                      <div>
                        <strong>{message.messageId}</strong>
                        <span>{message.source}</span>
                      </div>
                      <StatusPill status={message.displayStatus} />
                      <div>
                        <span>Age {formatMinutes(message.ageMinutes)}</span>
                        <span>Stale {formatMinutes(message.staleMinutes)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="task-pulse-detail-pane" aria-live="polite">
            <div className="task-pulse-list-head">
              <h2>Details</h2>
              {selectedMessage ? <StatusPill status={selectedMessage.displayStatus} /> : null}
            </div>

            {!selectedMessage ? (
              <p className="task-pulse-empty">Select a message to inspect timeline and raw excerpt.</p>
            ) : (
              <>
                <dl className="task-pulse-detail-grid">
                  <DetailField label="message_id" value={selectedMessage.messageId} mono />
                  <DetailField label="source" value={selectedMessage.source} />
                  <DetailField label="status" value={selectedMessage.displayStatus} />
                  <DetailField label="timestamp" value={formatTimestamp(selectedMessage.timestamp)} />
                  <DetailField label="firstSeenAt" value={formatTimestamp(selectedMessage.firstSeenAt)} />
                  <DetailField label="lastSeenAt" value={formatTimestamp(selectedMessage.lastSeenAt)} />
                  <DetailField label="closedAt" value={formatTimestamp(selectedMessage.closedAt)} />
                  <DetailField label="claimedAt" value={formatTimestamp(selectedMessage.claimedAt)} />
                  <DetailField label="ageMinutes" value={formatMinutes(selectedMessage.ageMinutes)} />
                  <DetailField label="staleMinutes" value={formatMinutes(selectedMessage.staleMinutes)} />
                </dl>

                <h3>Raw excerpt</h3>
                <pre>{selectedMessage.excerpt || '(empty)'}</pre>
              </>
            )}
          </aside>
        </section>

        {error ? <p className="task-pulse-error">API error: {error}</p> : null}
      </section>
    </main>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="task-pulse-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : ''}>{value}</dd>
    </div>
  )
}

function StatusPill({ status }: { status: TaskPulseMessage['displayStatus'] }) {
  return <span className={`task-pulse-pill task-pulse-pill--${status}`}>{status}</span>
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—'
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return value
  }

  return new Date(timestamp).toLocaleString()
}

function formatMinutes(value: number | null): string {
  if (value === null) {
    return '—'
  }

  return `${value}m`
}

export default TaskPulsePage
