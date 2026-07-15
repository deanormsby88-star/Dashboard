/**
 * Deep links into Waze for turn-by-turn navigation. No API/key needed — Waze
 * resolves a free-text location query on the device. Tapping the link on the
 * phone opens the Waze app (or the web fallback) already navigating.
 */
export function wazeLink(location: string): string {
  return `https://www.waze.com/ul?q=${encodeURIComponent(location)}&navigate=yes`;
}

/** Online/virtual meeting markers — no point navigating to these. */
const ONLINE_PATTERNS = [
  /teams/i,
  /zoom/i,
  /google meet/i,
  /meet\.google/i,
  /\bmeet\b/i,
  /\bonline\b/i,
  /\bvirtual\b/i,
  /skype/i,
  /webex/i,
  /gotomeeting/i,
  /\bhttps?:\/\//i,
];
/**
 * Dean's own workplace / internal rooms — no directions needed. Kept specific
 * so genuine client sites (e.g. "Anchor Offices") still get a link.
 */
const OFFICE_PATTERNS = [
  /beyachad/i,
  /heya\s*sa/i,
  /dean'?s office/i,
  /\b(in|my|the)\s+office\b/i,
  /^\s*office\s*$/i,
  /boardroom/i,
  /meeting room/i,
];

/**
 * A Waze link only when it's worth one: a real, physical place that isn't
 * online and isn't Dean's Beyachad office. Returns null otherwise.
 */
export function wazeLinkFor(location: string | null | undefined): string | null {
  const l = location?.trim();
  if (!l) return null;
  if (OFFICE_PATTERNS.some((r) => r.test(l))) return null;
  if (ONLINE_PATTERNS.some((r) => r.test(l))) return null;
  return wazeLink(l);
}
