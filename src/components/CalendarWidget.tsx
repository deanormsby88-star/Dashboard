'use client'
import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import type { CalendarEvent } from '@/lib/graph'
import clsx from 'clsx'

interface Props {
  endpoint: string
  title: string
  subtitle?: string
}

const showAsColor: Record<string, string> = {
  busy: 'bg-blue-500',
  tentative: 'bg-yellow-500',
  free: 'bg-emerald-500',
  oof: 'bg-red-500',
  workingElsewhere: 'bg-purple-500',
}

function EventTime(event: CalendarEvent) {
  if (event.isAllDay) return 'All day'
  const start = format(parseISO(event.start.dateTime), 'h:mm a')
  const end = format(parseISO(event.end.dateTime), 'h:mm a')
  return `${start} – ${end}`
}

export default function CalendarWidget({ endpoint, title, subtitle }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setEvents(data)
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetch_])

  return (
    <div className="card flex flex-col h-full">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <span className="mr-2">📅</span>{title}
          </h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={fetch_} className="refresh-btn" title="Refresh">
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      <div className="card-body">
        {error ? (
          <ErrorState message={error} />
        ) : loading && events.length === 0 ? (
          <SkeletonList count={4} />
        ) : events.length === 0 ? (
          <EmptyState message="No events scheduled for today" />
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="event-item group">
                <div className={clsx('w-1 rounded-full flex-shrink-0 self-stretch', showAsColor[ev.showAs] ?? 'bg-slate-600')} />
                <div className="flex-1 min-w-0">
                  <a
                    href={ev.webLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-slate-100 group-hover:text-blue-400 transition-colors truncate block"
                  >
                    {ev.subject}
                  </a>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-400">{EventTime(ev)}</span>
                    {ev.location?.displayName && (
                      <span className="text-xs text-slate-500 truncate max-w-[160px]">
                        📍 {ev.location.displayName}
                      </span>
                    )}
                    {ev.isOnlineMeeting && (
                      <span className="text-xs text-blue-400">🎥 Online</span>
                    )}
                  </div>
                </div>
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
      className={clsx('w-4 h-4', spinning && 'animate-spin')}
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
      <span className="text-3xl mb-2">🎉</span>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex gap-3 items-start animate-pulse">
          <div className="w-1 h-10 rounded-full bg-slate-700 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-slate-700 rounded w-3/4" />
            <div className="h-3 bg-slate-800 rounded w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  )
}
