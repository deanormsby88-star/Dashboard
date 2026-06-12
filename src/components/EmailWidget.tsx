'use client'
import { useEffect, useState, useCallback } from 'react'
import { format, parseISO, isToday, isYesterday, formatDistanceToNow } from 'date-fns'
import type { EmailMessage, InboxStats } from '@/lib/graph'

interface EmailData {
  stats: InboxStats
  messages: EmailMessage[]
}

function formatDate(dateStr: string) {
  const date = parseISO(dateStr)
  if (isToday(date)) return format(date, 'h:mm a')
  if (isYesterday(date)) return 'Yesterday'
  return formatDistanceToNow(date, { addSuffix: true })
}

export default function EmailWidget() {
  const [data, setData] = useState<EmailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/email')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetch_])

  return (
    <div className="card flex flex-col h-full">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <h2 className="card-title">
            <span className="mr-2">📬</span>Inbox
          </h2>
          {data && data.stats.unread > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white min-w-[20px]">
              {data.stats.unread}
            </span>
          )}
        </div>
        <button onClick={fetch_} className="refresh-btn" title="Refresh">
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      {data && (
        <div className="px-4 py-2 border-b border-slate-800 flex gap-4 text-xs text-slate-400">
          <span>
            <span className="font-medium text-red-400">{data.stats.unread}</span> unread
          </span>
          <span>
            <span className="font-medium text-slate-300">{data.stats.total}</span> total
          </span>
          <span className="ml-auto text-slate-500">Awaiting your response</span>
        </div>
      )}

      <div className="card-body">
        {error ? (
          <ErrorState message={error} />
        ) : loading && !data ? (
          <SkeletonList count={5} />
        ) : !data || data.messages.length === 0 ? (
          <EmptyState message="All caught up! No messages need your attention." />
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {data.messages.map((msg) => (
              <li key={msg.id}>
                <a
                  href={msg.webLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 hover:bg-slate-800/40 transition-colors rounded-lg group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-slate-300">
                      {(msg.from.emailAddress.name || msg.from.emailAddress.address)[0].toUpperCase()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                        {msg.from.emailAddress.name || msg.from.emailAddress.address}
                      </span>
                      <span className="text-xs text-slate-500 flex-shrink-0">
                        {formatDate(msg.receivedDateTime)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 truncate mt-0.5">
                      {!msg.isRead && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 mb-0.5" />
                      )}
                      {msg.subject || '(no subject)'}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{msg.bodyPreview}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lastUpdated && (
        <div className="card-footer">
          Updated {format(lastUpdated, 'h:mm a')}
        </div>
      )}
    </div>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? 'w-4 h-4 animate-spin' : 'w-4 h-4'}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-4">
      <span className="text-2xl mb-2">⚠️</span>
      <p className="text-sm text-red-400">{message}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-4">
      <span className="text-3xl mb-2">✅</span>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <ul className="divide-y divide-slate-800/60">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 p-3 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <div className="h-3 bg-slate-700 rounded w-1/3" />
              <div className="h-3 bg-slate-800 rounded w-12" />
            </div>
            <div className="h-3 bg-slate-700 rounded w-2/3" />
            <div className="h-3 bg-slate-800 rounded w-full" />
          </div>
        </li>
      ))}
    </ul>
  )
}
