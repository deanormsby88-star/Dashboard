import {
  appendConversationMessage,
  findPersonByName,
  getLastSyncRun,
  getPerson,
  listCommitments,
  listPeopleWithCounts,
  recordSyncRun,
} from "@/lib/db/repo";
import { sendToUser, sendToUserWithButtons } from "@/lib/telegram/notify";
import { allowedSignupDomains, emailDomainAllowed } from "@/lib/env";
import { businessDaysStale, loopNeedsNudge } from "@/lib/accountability/staleness";
import { draftChase, stagePendingChase } from "@/lib/accountability/chase";
import type { Owner } from "@/lib/db/repo";
import type { Business, Commitment } from "@/lib/types";
import type { InlineButton } from "@/lib/telegram/api";

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

function fmtDay(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Map a commitment's business to a mail-capable mailbox key. */
function mailboxFor(businesses: Business[], businessId: string | null): "heya" | "jic" {
  const b = businesses.find((x) => x.id === businessId);
  return b?.key === "jic" ? "jic" : "heya";
}

function businessLabel(businesses: Business[], businessId: string | null): string {
  const b = businesses.find((x) => x.id === businessId);
  return b?.name ?? "";
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
    const label = businessLabel(owner.businesses, c.business_id);
    const bizBit = label ? ` · ${label}` : "";
    const whenBit = c.due_date ? `due ${fmtDay(c.due_date)}` : `${staleDays} business day(s)`;
    const whoBit = owe
      ? personName !== "them"
        ? `To ${personName}`
        : ""
      : `From ${personName}${isTeammate ? " (your team)" : ""}`;

    const waitingHead = isTeammate ? "🟠 Your team owes you" : "🟠 Waiting on";
    const lines = [owe ? `🔴 You owe: ${c.text}` : `${waitingHead}: ${c.text}`];
    lines.push([whoBit, whenBit].filter(Boolean).join(" · ") + bizBit);

    const buttons: InlineButton[][] = [];
    if (email) {
      const draft = await draftChase(c, personName, staleDays);
      if (draft) {
        const chaseId = await stagePendingChase(owner, {
          commitmentId: c.id,
          direction: c.direction,
          personName,
          personEmail: email,
          businessKey: mailboxFor(owner.businesses, c.business_id),
          subject: owe ? `Update: ${c.text}`.slice(0, 120) : `Following up: ${c.text}`.slice(0, 120),
          draft,
        });
        lines.push(`\nDraft ${owe ? "update" : "chase"} ready:\n“${draft}”`);
        buttons.push([
          { text: "📤 Send via Teams", callback_data: `loop:teams:${chaseId}` },
          { text: "✉️ Email", callback_data: `loop:email:${chaseId}` },
        ]);
      }
    }
    buttons.push([
      { text: "😴 Snooze 2d", callback_data: `loop:snooze:${c.id}` },
      { text: "✅ Done", callback_data: `loop:done:${c.id}` },
    ]);

    const msg = lines.join("\n");
    const ok = await sendToUserWithButtons(owner.user.id, msg, buttons);
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: `loopnudge:${c.id}`, stats: { text: c.text } });
      await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
      sent++;
    }
  }
  return { sent, scanned };
}

const DIGEST_COOLDOWN_HOURS = 24 * 6; // once a week, guarded

function digestSection(title: string, items: Commitment[], now: Date, businesses: Business[]): string {
  if (!items.length) return "";
  const rows = items
    .slice()
    .sort((a, b) => businessDaysStale(b, now) - businessDaysStale(a, now))
    .slice(0, 12)
    .map((c) => {
      const who = c.person_name ? ` — ${c.person_name}` : "";
      const label = businessLabel(businesses, c.business_id);
      const biz = label ? ` (${label})` : "";
      const age = c.due_date ? `due ${fmtDay(c.due_date)}` : `${businessDaysStale(c, now)}d`;
      return `• ${c.text}${who} · ${age}${biz}`;
    });
  return `${title}\n${rows.join("\n")}`;
}

/**
 * Monday "Open Loops" digest across all of Dean's businesses: what he owes and
 * what he's waiting on, most stale first. One message, once a week.
 */
export async function openLoopsDigest(owner: Owner, now: Date = new Date()): Promise<{ sent: boolean }> {
  if (within(await getLastSyncRun("loopsdigest"), now, DIGEST_COOLDOWN_HOURS)) return { sent: false };

  const open = (await listCommitments(owner.user.id)).filter((c) => c.status === "open");
  const owed = open.filter((c) => c.direction === "by_dean");
  const waiting = open.filter((c) => c.direction === "to_dean");

  // Classify waiting-on items as "your team" vs external using each person's email.
  const domains = orgDomains(owner);
  const people = await listPeopleWithCounts(owner.user.id);
  const emailById = new Map(people.map((p) => [p.id, p.email]));
  const emailByName = new Map(
    people.filter((p) => p.email).map((p) => [p.full_name.toLowerCase(), p.email])
  );
  const isTeam = (c: Commitment): boolean => {
    const e =
      (c.person_id && emailById.get(c.person_id)) ||
      (c.person_name && emailByName.get(c.person_name.toLowerCase())) ||
      null;
    return e ? emailDomainAllowed(e, domains) : false;
  };
  const waitingTeam = waiting.filter(isTeam);
  const waitingExternal = waiting.filter((c) => !isTeam(c));

  const sections = [
    digestSection("🔴 You owe", owed, now, owner.businesses),
    digestSection("🟠 Your team owes you", waitingTeam, now, owner.businesses),
    digestSection("🟠 Waiting on others", waitingExternal, now, owner.businesses),
  ].filter(Boolean);

  const msg = sections.length
    ? `🗒 Open loops — your week\n\n${sections.join("\n\n")}\n\nTap a nudge as they come in to chase, snooze or close each one.`
    : `🗒 Open loops — your week\n\nAll clear — nothing outstanding on either side. Nice.`;

  const ok = await sendToUser(owner.user.id, msg);
  if (ok) {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: "loopsdigest", stats: { count: open.length } });
    await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
  }
  return { sent: ok };
}
