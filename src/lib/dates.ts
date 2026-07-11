/**
 * Business-day arithmetic for commitment aging (brief §10: after 3 business
 * days with no response, suggest escalation).
 */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

export const ESCALATION_BUSINESS_DAYS = 3;
