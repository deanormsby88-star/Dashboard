/**
 * Deep links into Waze for turn-by-turn navigation. No API/key needed — Waze
 * resolves a free-text location query on the device. Tapping the link on the
 * phone opens the Waze app (or the web fallback) already navigating.
 */
export function wazeLink(location: string): string {
  return `https://www.waze.com/ul?q=${encodeURIComponent(location)}&navigate=yes`;
}
