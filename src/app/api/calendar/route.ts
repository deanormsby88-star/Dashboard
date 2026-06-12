import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMyCalendar } from '@/lib/graph'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const events = await getMyCalendar(session.accessToken)
    return NextResponse.json(events)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Graph API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
