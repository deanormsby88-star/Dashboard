import { findPersonByName, getLastSyncRun, getPerson, listCommitments, recordSyncRun } from "@/lib/db/repo";
import { allowedSignupDomains, emailDomainAllowed } from "@/lib/env";
import { businessDaysStale, loopNeedsNudge } from "@/lib/accountability/staleness";
import { draftChase, stagePendingChase } from "@/lib/accountability/chase";
import type { Owner } from "@/lib/db/repo";
import type { Business } from "@/lib/types";

/** Org domains that mark a contact as one of Dean's own team (vs external). */
function orgDomains(owner: Owner): string[] {
  const own = owner.user.email.split("@")[1]?.toLowerCase();
  const set = new Set(allowedSignupDomains());
  if (own) set.add(own);
  return [...set];
}

const COOLDOWN_HOURS = 48; // don't re-nudge the same loop within 2 days
const SNOOZE_HOURS = 120; // "Snooze 2d" button parks a loop for ~5 days

function within(last: Date | null, now: Date, hours: number): boolean {
  return !!last && now.getTime() - last.getTime() < hours * 3600_000;
}

/** Map a commitment's business to a mail-capable mailbox key. */
function mailboxFor(businesses: Business[], businessId: string | null): "heya" | "jic" {
  const b = businesses.find((x) => x.id === businessId);
  return b?.key === "jic" ? "jic" : "heya";
}

/**
 * Scan open commitments and nudge Dean about anything that's gone stale. In
 * Assertive mode we pre-draft the chase so a single tap sends it (the draft is
 * shown inline, so nothing goes out unseen). Cooldown + snooze prevent spam.
 */
export async function scanOpenLoops(owner: Owner, now: Date = new Date()): Promise<{ sent: number; scanned: number }> {
  const commitments = (await listCommitments(owner.user.id)).filter((c) => c.status === "open");
  const domains = orgDomains(owner);

  let sent = 0;
  let scanned = 0;
  for (const c of commitments) {
    // Resolve the person + a contact address first — it decides teammate cadence.
    let email: string | null = null;
    let personName = c.person_name ?? "them";
    let person = c.person_id ? await getPerson(owner.user.id, c.person_id) : null;
    if (!person && c.person_name) person = await findPersonByName(owner.user.id, c.person_name);
    if (person) {
      email = person.email;
      personName = c.person_name ?? person.full_name ?? "them";
    }
    const isTeammate = email ? emailDomainAllowed(email, domains) : false;

    if (!loopNeedsNudge(c, now, undefined, isTeammate)) continue;
    scanned++;

    if (within(await getLastSyncRun(`loopnudge:${c.id}`), now, COOLDOWN_HOURS)) continue;
    if (within(await getLastSyncRun(`loopsnooze:${c.id}`), now, SNOOZE_HOURS)) continue;

    const staleDays = businessDaysStale(c, now);
    const owe = c.direction === "by_dean";

    // No individual Telegram nudge — stage a ready-to-send chase draft (when we
    // have a contact address) and let the open commitment itself, plus the
    // draft, surface on the /review page for a single end-of-day pass.
    if (email) {
      const draft = await draftChase(c, personName, staleDays);
      if (draft) {
        await stagePendingChase(owner, {
          commitmentId: c.id,
          direction: c.direction,
          personName,
          personEmail: email,
          businessKey: mailboxFor(owner.businesses, c.business_id),
          subject: owe ? `Update: ${c.text}`.slice(0, 120) : `Following up: ${c.text}`.slice(0, 120),
          draft,
        });
      }
    }
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `loopnudge:${c.id}`, stats: { text: c.text } });
    sent++;
  }
  return { sent, scanned };
}
