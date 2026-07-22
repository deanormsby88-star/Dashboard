/**
 * People Dean has explicitly removed from DeanOS. They must not surface
 * anywhere — directory, meeting prep, motivations, snapshots, reminders — even
 * if a stale row lingers in the `people` table. Read-layer functions consult
 * this so removal is immediate and complete without a database migration.
 */

const REMOVED_EMAILS = new Set(["lisaw@heya.team"]);
// Full name (not a bare first name) so a future different "Lisa" isn't caught.
const REMOVED_NAME = /\blisa\s+wainbergas\b/i;

export function isRemovedPerson(p: { full_name?: string | null; email?: string | null }): boolean {
  const email = (p.email ?? "").trim().toLowerCase();
  if (email && REMOVED_EMAILS.has(email)) return true;
  const name = (p.full_name ?? "").trim();
  return name ? REMOVED_NAME.test(name) : false;
}
