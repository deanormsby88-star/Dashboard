import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserCalendar } from '@/lib/graph'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const ceoEmail = process.env.CEO_EMAIL
  if (!ceoEmail) {
    return NextResponse.json({ error: 'CEO_EMAIL not configured' }, { status: 400 })
  }
  try {
    const events = await getUserCalendar(session.accessToken, ceoEmail)
    return NextResponse.json(events)
  } catch (err: unknown) {
    const code = (err as { statusCode?: number }).statusCode
    if (code === 403) {
      return NextResponse.json(
        { error: 'Calendar not shared. Ask Yehuda to share their calendar with you, or grant your account delegate access.' },
        { status: 403 }
      )
    }
    const msg = err instanceof Error ? err.message : 'Graph API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
