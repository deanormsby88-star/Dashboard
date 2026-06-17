import { Client } from '@microsoft/microsoft-graph-client'

export interface CronEmailMessage {
  id: string
  subject: string
  from: { emailAddress: { name: string; address: string } }
  receivedDateTime: string
  bodyPreview: string
  webLink: string
}

export async function getAppAccessToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AZURE_AD_CLIENT_ID!,
      client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`App token error: ${JSON.stringify(err)}`)
  }
  const data = await res.json()
  return data.access_token
}

function getClient(accessToken: string) {
  return Client.init({ authProvider: (done) => done(null, accessToken) })
}

export async function searchInboxBySubject(
  accessToken: string,
  userEmail: string,
  keyword: string
): Promise<CronEmailMessage[]> {
  const client = getClient(accessToken)
  const safe = keyword.replace(/'/g, "''")
  const res = await client
    .api(`/users/${encodeURIComponent(userEmail)}/mailFolders/Inbox/messages`)
    .filter(`contains(subject, '${safe}')`)
    .select('id,subject,from,receivedDateTime,bodyPreview,webLink')
    .orderby('receivedDateTime desc')
    .top(50)
    .get()
  return res.value ?? []
}

export async function getOrCreateInboxSubfolder(
  accessToken: string,
  userEmail: string,
  folderName: string
): Promise<string> {
  const client = getClient(accessToken)
  const safe = folderName.replace(/'/g, "''")
  const existing = await client
    .api(`/users/${encodeURIComponent(userEmail)}/mailFolders/Inbox/childFolders`)
    .filter(`displayName eq '${safe}'`)
    .get()

  if (existing.value?.length > 0) return existing.value[0].id

  const created = await client
    .api(`/users/${encodeURIComponent(userEmail)}/mailFolders/Inbox/childFolders`)
    .post({ displayName: folderName })
  return created.id
}

export async function moveEmailToFolder(
  accessToken: string,
  userEmail: string,
  messageId: string,
  folderId: string
): Promise<void> {
  const client = getClient(accessToken)
  await client
    .api(`/users/${encodeURIComponent(userEmail)}/messages/${messageId}/move`)
    .post({ destinationId: folderId })
}

export async function sendDailyDigest(
  accessToken: string,
  userEmail: string,
  messages: CronEmailMessage[],
  keyword: string
): Promise<void> {
  const client = getClient(accessToken)

  const date = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: process.env.DIGEST_TIMEZONE || 'Australia/Sydney',
  })

  const rows = messages
    .map((m) => {
      const time = new Date(m.receivedDateTime).toLocaleTimeString('en-AU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: process.env.DIGEST_TIMEZONE || 'Australia/Sydney',
      })
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${esc(m.subject)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            ${esc(m.from.emailAddress.name)}<br>
            <span style="color:#888;font-size:12px;">${esc(m.from.emailAddress.address)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;color:#555;">${time}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:13px;">${esc(m.bodyPreview)}</td>
        </tr>`
    })
    .join('')

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:860px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">Daily Digest</h1>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">${date}</p>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;border-bottom:1px solid #e2e8f0;">
        <p style="margin:0;color:#475569;font-size:14px;">
          <strong>${messages.length}</strong> email${messages.length !== 1 ? 's' : ''} matching
          <em>"${esc(keyword)}"</em> found today. They have been filed in your
          <strong>Daily Digest</strong> folder.
        </p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;">Subject</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;">From</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;">Time</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;">Preview</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Sent automatically at 11:59 pm by your Dashboard.</p>
      </div>
    </div>`

  await client.api(`/users/${encodeURIComponent(userEmail)}/sendMail`).post({
    message: {
      subject: `Daily Digest — ${date} (${messages.length} email${messages.length !== 1 ? 's' : ''})`,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: userEmail } }],
    },
    saveToSentItems: false,
  })
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
