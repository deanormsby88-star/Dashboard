import { NextRequest, NextResponse } from 'next/server'
import {
  getAppAccessToken,
  searchInboxBySubject,
  getOrCreateInboxSubfolder,
  moveEmailToFolder,
  sendDailyDigest,
} from '@/lib/graph-cron'

const KEYWORD = process.env.EMAIL_SUBJECT_KEYWORD || 'Daily Summary Report'
const FOLDER_NAME = process.env.EMAIL_DIGEST_FOLDER || 'Daily Digest'

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userEmail = process.env.MAILBOX_USER_EMAIL
  if (!userEmail) {
    return NextResponse.json({ error: 'MAILBOX_USER_EMAIL not configured' }, { status: 500 })
  }

  try {
    const accessToken = await getAppAccessToken()

    const messages = await searchInboxBySubject(accessToken, userEmail, KEYWORD)

    if (messages.length === 0) {
      return NextResponse.json({ message: 'No matching emails found', count: 0 })
    }

    // Send consolidated digest first; only file if send succeeds
    await sendDailyDigest(accessToken, userEmail, messages, KEYWORD)

    const folderId = await getOrCreateInboxSubfolder(accessToken, userEmail, FOLDER_NAME)

    await Promise.all(
      messages.map((m) => moveEmailToFolder(accessToken, userEmail, m.id, folderId))
    )

    return NextResponse.json({
      message: 'Daily digest sent and emails filed',
      count: messages.length,
      folder: FOLDER_NAME,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[email-consolidation]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
