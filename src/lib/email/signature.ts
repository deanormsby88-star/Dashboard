function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build the HTML body + inline attachments for a mailbox's signature (empty for none). */
export async function signedEmailBody(
  _mailbox: "jic",
  body: string
): Promise<{ html?: string; attachments?: unknown[] }> {
  const jic = await withJicSignature(body);
  return jic ? { html: jic.html, attachments: jic.attachments } : {};
}

// ── JIC signature (a designed banner image, imported from Dean's mailbox) ────

import { listSyncRunsBySource } from "@/lib/db/repo";

const JIC_SIG_SOURCE = "jicsig";
const JIC_LOGO_CID = "jicsig";

/** The stored JIC signature image, or null if not imported yet. */
export async function jicSignatureImage(): Promise<{ base64: string; contentType: string } | null> {
  const rows = await listSyncRunsBySource(JIC_SIG_SOURCE, 3650);
  const s = rows[0]?.stats as { base64?: string; contentType?: string } | undefined;
  if (!s?.base64) return null;
  return { base64: s.base64, contentType: s.contentType ?? "image/png" };
}

/**
 * Wrap a plain-text body as HTML with the JIC banner signature embedded inline
 * (CID). Returns null when no JIC signature has been imported.
 */
export async function withJicSignature(
  bodyText: string
): Promise<{ html: string; attachments: unknown[] } | null> {
  const img = await jicSignatureImage();
  if (!img) return null;
  const body = escapeHtml(bodyText).replace(/\r?\n/g, "<br>");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">${body}<br><br><img src="cid:${JIC_LOGO_CID}" alt="Just Imagine Consulting" style="display:block;border:0;max-width:480px;width:100%;height:auto;" /></div>`;
  const ext = img.contentType.includes("jpeg") || img.contentType.includes("jpg") ? "jpg" : "png";
  const attachments = [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: `jic-signature.${ext}`,
      contentType: img.contentType,
      contentBytes: img.base64,
      isInline: true,
      contentId: JIC_LOGO_CID,
    },
  ];
  return { html, attachments };
}
