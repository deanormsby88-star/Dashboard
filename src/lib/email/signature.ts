import { HEYA_LOGO_BASE64 } from "@/lib/email/logo";

/** Content-ID for the inline logo, referenced as <img src="cid:..."> and set on the attachment. */
export const LOGO_CID = "heyalogo";

/** Inline logo attachment for Graph sendMail / draft, so the logo always renders (no remote-image blocking). */
export const heyaLogoAttachment = {
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: "heya-logo.png",
  contentType: "image/png",
  contentBytes: HEYA_LOGO_BASE64,
  isInline: true,
  contentId: LOGO_CID,
};

/**
 * Dean's Heya email signature as email-safe HTML (table layout, inline styles).
 * The logo is embedded inline via CID (see heyaLogoAttachment) so it always
 * displays — remote-hosted signature images get blocked by Outlook/Gmail.
 */
export function heyaSignatureHtml(): string {
  const ring = (color: string) => `<span style="color:${color};font-size:12px;">&#9675;</span>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#4a5568;font-size:13px;line-height:1.6;margin-top:10px;">
  <tr>
    <td style="vertical-align:middle;padding-right:22px;">
      <img src="cid:${LOGO_CID}" alt="heya" width="155" style="display:block;border:0;width:155px;height:auto;" />
    </td>
    <td style="padding:0;">
      <div style="width:3px;height:104px;background-color:#4aa543;background-image:linear-gradient(180deg,#4aa543 0%,#3f77bd 55%,#c0398f 100%);"></div>
    </td>
    <td style="vertical-align:middle;padding-left:22px;">
      <div style="font-weight:bold;font-size:16px;color:#2f6db3;">Dean Ormsby</div>
      <div style="color:#9aa3b2;margin-bottom:8px;">COO</div>
      <div>${ring("#c0398f")}&nbsp;&nbsp;072.457.6258</div>
      <div>${ring("#4aa543")}&nbsp;&nbsp;561.408.7250 <span style="color:#9aa3b2;">direct</span></div>
      <div>${ring("#3f77bd")}&nbsp;&nbsp;<a href="mailto:deano@heya.team" style="color:#2f6db3;text-decoration:underline;">deano@heya.team</a></div>
      <div>${ring("#c0398f")}&nbsp;&nbsp;<a href="https://www.heya.team" style="color:#2f6db3;text-decoration:underline;">www.heya.team</a></div>
    </td>
  </tr>
</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/** Wrap a plain-text body as HTML and append the Heya signature. */
export function withHeyaSignature(bodyText: string): string {
  const body = escapeHtml(bodyText).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">${body}<br><br>${heyaSignatureHtml()}</div>`;
}
