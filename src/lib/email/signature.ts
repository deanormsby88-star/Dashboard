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
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#3f4a5a;font-size:13px;line-height:1.5;margin-top:8px;">
  <tr>
    <td style="vertical-align:middle;padding-right:18px;">
      <img src="cid:${LOGO_CID}" alt="heya" width="130" style="display:block;border:0;width:130px;height:auto;" />
    </td>
    <td style="vertical-align:middle;border-left:3px solid #4a9e3f;padding-left:18px;">
      <div style="font-weight:bold;font-size:15px;color:#2f6db3;">Dean Ormsby</div>
      <div style="color:#8a94a6;margin-bottom:6px;">COO</div>
      <div><span style="color:#a23a7a;">&#9679;</span>&nbsp; 072 457 6258</div>
      <div><span style="color:#4a9e3f;">&#9679;</span>&nbsp; 561 408 7250 <span style="color:#8a94a6;">direct</span></div>
      <div><span style="color:#3f77bd;">&#9679;</span>&nbsp; <a href="mailto:deano@heya.team" style="color:#2f6db3;text-decoration:none;">deano@heya.team</a></div>
      <div><span style="color:#a23a7a;">&#9679;</span>&nbsp; <a href="https://www.heya.team" style="color:#2f6db3;text-decoration:none;">www.heya.team</a></div>
    </td>
  </tr>
</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap a plain-text body as HTML and append the Heya signature. */
export function withHeyaSignature(bodyText: string): string {
  const body = escapeHtml(bodyText).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">${body}<br><br>${heyaSignatureHtml()}</div>`;
}
