/**
 * People Dean has explicitly removed from Second. They must not surface
 * anywhere — directory, meeting prep, motivations, snapshots, reminders — even
 * if a stale row lingers in the `people` table. Read-layer functions consult
 * this so removal is immediate and complete without a database migration.
 *
 * Dean has left Heya: everyone on the heya.team domain is removed, so a
 * former colleague cc'd on a future email never resurfaces as a contact.
 */

const REMOVED_DOMAINS = new Set(["heya.team"]);

export function isRemovedPerson(p: { full_name?: string | null; email?: string | null }): boolean {
  const email = (p.email ?? "").trim().toLowerCase();
  const domain = email.split("@")[1];
  return Boolean(domain && REMOVED_DOMAINS.has(domain));
}
