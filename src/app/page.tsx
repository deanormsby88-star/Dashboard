'use client'
import { useSession, signIn } from 'next-auth/react'
import { useEffect, useState } from 'react'
import CalendarWidget from '@/components/CalendarWidget'
import EmailWidget from '@/components/EmailWidget'
import ProjectsWidget from '@/components/ProjectsWidget'

function useGreeting() {
  const [greeting, setGreeting] = useState('')
  const [time, setTime] = useState('')

  useEffect(() => {
    function update() {
      const now = new Date()
      const h = now.getHours()
      if (h < 12) setGreeting('Good morning')
      else if (h < 17) setGreeting('Good afternoon')
      else setGreeting('Good evening')
      setTime(now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }))
    }
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [])

  return { greeting, time }
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Loading dashboard…</p>
      </div>
    </div>
  )
}

function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-6 max-w-sm mx-auto p-8">
        <div className="text-5xl">🏠</div>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Command Centre</h1>
          <p className="text-sm text-slate-400 mt-2">Sign in with your Microsoft account to access your dashboard.</p>
        </div>
        <button
          onClick={() => signIn('azure-ad')}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
        >
          <MicrosoftIcon />
          Sign in with Microsoft
        </button>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const { greeting, time } = useGreeting()
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', month: 'long', day: 'numeric' })

  if (status === 'loading') return <LoadingScreen />
  if (!session) return <SignInPage />

  const ceoName = process.env.NEXT_PUBLIC_CEO_NAME ?? 'Yehuda'

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 bg-slate-950/90 backdrop-blur-sm z-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            {greeting}, {session.user?.name?.split(' ')[0] ?? 'Dean'} 👋
          </h1>
          <p className="text-xs text-slate-500">{today}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xl font-mono font-light text-slate-300">{time}</span>
          <button
            onClick={() => signIn('azure-ad')}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            title="Re-authenticate"
          >
            {session.user?.email}
          </button>
        </div>
      </header>

      {session.error === 'RefreshAccessTokenError' && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-sm text-red-300 flex items-center justify-between">
          <span>Your session expired. Please sign in again.</span>
          <button onClick={() => signIn('azure-ad')} className="underline ml-4 flex-shrink-0">
            Sign in
          </button>
        </div>
      )}

      {/* Dashboard Grid */}
      <main className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ gridAutoRows: '520px' }}>
        <CalendarWidget
          endpoint="/api/calendar"
          title="My Calendar"
          subtitle="Today's schedule"
        />
        <EmailWidget />
        <CalendarWidget
          endpoint="/api/ceo-calendar"
          title={`${ceoName}'s Calendar`}
          subtitle="CEO — today's schedule"
        />
        <ProjectsWidget />
      </main>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}
