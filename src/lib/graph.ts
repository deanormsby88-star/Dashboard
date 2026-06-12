import { Client } from '@microsoft/microsoft-graph-client'
import { startOfDay, endOfDay } from 'date-fns'

function getClient(accessToken: string) {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  })
}

export interface CalendarEvent {
  id: string
  subject: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  location?: { displayName: string }
  isAllDay: boolean
  showAs: string
  organizer?: { emailAddress: { name: string; address: string } }
  webLink?: string
  isOnlineMeeting?: boolean
  onlineMeetingUrl?: string
}

export interface EmailMessage {
  id: string
  subject: string
  from: { emailAddress: { name: string; address: string } }
  receivedDateTime: string
  bodyPreview: string
  isRead: boolean
  webLink: string
  conversationId: string
}

export interface InboxStats {
  unread: number
  total: number
}

const CAL_SELECT = 'id,subject,start,end,location,isAllDay,showAs,organizer,webLink,isOnlineMeeting,onlineMeetingUrl'

export async function getMyCalendar(accessToken: string): Promise<CalendarEvent[]> {
  const client = getClient(accessToken)
  const start = startOfDay(new Date()).toISOString()
  const end = endOfDay(new Date()).toISOString()

  const res = await client
    .api('/me/calendarView')
    .query({ startDateTime: start, endDateTime: end })
    .orderby('start/dateTime')
    .select(CAL_SELECT)
    .get()

  return res.value ?? []
}

export async function getUserCalendar(accessToken: string, userEmail: string): Promise<CalendarEvent[]> {
  const client = getClient(accessToken)
  const start = startOfDay(new Date()).toISOString()
  const end = endOfDay(new Date()).toISOString()

  const res = await client
    .api(`/users/${encodeURIComponent(userEmail)}/calendarView`)
    .query({ startDateTime: start, endDateTime: end })
    .orderby('start/dateTime')
    .select(CAL_SELECT)
    .get()

  return res.value ?? []
}

export async function getInboxStats(accessToken: string): Promise<InboxStats> {
  const client = getClient(accessToken)
  const folder = await client
    .api('/me/mailFolders/Inbox')
    .select('unreadItemCount,totalItemCount')
    .get()
  return { unread: folder.unreadItemCount, total: folder.totalItemCount }
}

export async function getEmailsNeedingResponse(accessToken: string): Promise<EmailMessage[]> {
  const client = getClient(accessToken)

  const me = await client.api('/me').select('mail,userPrincipalName').get()
  const myEmail = (me.mail || me.userPrincipalName || '').toLowerCase()

  // Get the most recent inbox messages not sent by me — these are candidates for response
  const res = await client
    .api('/me/mailFolders/Inbox/messages')
    .filter(`from/emailAddress/address ne '${myEmail}'`)
    .orderby('receivedDateTime desc')
    .top(25)
    .select('id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,conversationId')
    .get()

  return res.value ?? []
}
