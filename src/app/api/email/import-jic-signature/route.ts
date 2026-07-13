import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, recordSyncRun } from "@/lib/db/repo";
import { getMessageAttachments, getValidAccessToken, searchMessages } from "@/lib/calendar/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import Dean's JIC email-signature banner from his mailbox. Email the image to
 * yourself with "signature" in the subject, then POST here: it finds that
 * message, grabs the image attachment, and stores it for use on JIC emails.
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const owner = await ensureOwner();
  const token = await getValidAccessToken(owner.user.id, "jic");
  if (!token) return NextResponse.json({ error: "JIC mailbox not connected." }, { status: 400 });

  const msgs = await searchMessages(token, { query: "signature", top: 10 });
  for (const m of msgs) {
    const atts = await getMessageAttachments(token, m.id);
    const img = atts.find((a) => a.contentType.startsWith("image/") && a.contentBytes);
    if (img) {
      await recordSyncRun({
        userId: owner.user.id,
        sourceSystem: "jicsig",
        stats: { base64: img.contentBytes, contentType: img.contentType, name: img.name },
      });
      return NextResponse.json({ ok: true, imported: img.name, from: m.subject });
    }
  }
  return NextResponse.json(
    { error: "No image attachment found in a recent email with 'signature' in the subject. Email the banner to yourself (subject: signature) and try again." },
    { status: 404 }
  );
}
