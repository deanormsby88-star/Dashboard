import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getInboxStats, getEmailsNeedingResponse } from '@/lib/graph'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const [stats, messages] = await Promise.all([
      getInboxStats(session.accessToken),
      getEmailsNeedingResponse(session.accessToken),
    ])
    return NextResponse.json({ stats, messages })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Graph API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
