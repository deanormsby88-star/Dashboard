import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import {
  ensureOwner,
  getLastSyncRun,
  insertAiRun,
  listCommitments,
  listEmails,
  listRisks,
  listTasks,
  recordSyncRun,
} from "@/lib/db/repo";
import { businessDaysBetween, ESCALATION_BUSINESS_DAYS } from "@/lib/dates";
import { sendToDean } from "@/lib/telegram/notify";

export const WATCH_PROMPT_VERSION = "1.0.0";

/** Don't raise the same signal again within this window (hours). */
const COOLDOWN_HOURS = 20;
/** Cap signals sent to the model to bound tokens. */
const MAX_SIGNALS = 24;

interface Signal {
  key: string; // stable dedup key (survives cache churn via sync_runs)
  id: string; // short handle the model refers to
  kind: string;
  text: string; // one-line description for the model
}

function daysAgo(d: Date | null | undefined, now: Date): number {
  return d ? businessDaysBetween(new Date(d), now) : 0;
}

/** Everything that *might* warrant interrupting Dean, before judgement/dedup. */
async function gatherSignals(now: Date): Promise<Signal[]> {
  const [commitments, risks, createdTasks, emails] = await Promise.all([
    listCommitments(),
    listRisks(),
    listTasks({ status: "created" }),
    listEmails({ unresolvedOnly: true, limit: 40 }),
  ]);

  const signals: Signal[] = [];
  let n = 0;
  const nextId = () => `s${++n}`;

  for (const c of commitments) {
    if (c.status !== "open") continue;
    const age = daysAgo(c.date_made ?? c.created_at, now);
    if (c.direction === "to_dean" && age >= ESCALATION_BUSINESS_DAYS) {
      signals.push({
        key: `watch:chase:${c.id}`,
        id: nextId(),
        kind: "waiting_on",
        text: `Waiting on ${c.person_name ?? "someone"} for "${c.text}" — ${age} business days now, no movement.`,
      });
    }
    if (c.direction === "by_dean" && age >= ESCALATION_BUSINESS_DAYS) {
      signals.push({
        key: `watch:owe:${c.id}`,
        id: nextId(),
        kind: "owed_by_dean",
        text: `You promised ${c.person_name ?? "someone"}: "${c.text}" — made ${age} business days ago, still open.`,
      });
    }
  }

  for (const r of risks) {
    if (r.status === "open" && r.severity === "high") {
      signals.push({
        key: `watch:risk:${r.id}`,
        id: nextId(),
        kind: "risk",
        text: `High-severity risk still open: "${r.description}".`,
      });
    }
  }

  const today = now.toISOString().slice(0, 10);
  for (const t of createdTasks) {
    const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
    if (due && due < today) {
      signals.push({
        key: `watch:task:${t.id}:${due}`,
        id: nextId(),
        kind: "overdue_task",
        text: `Overdue task (due ${due}): "${t.title}".`,
      });
    }
  }

  for (const e of emails) {
    if (e.classification !== "action") continue;
    const ageMs = now.getTime() - new Date(e.email_date ?? e.created_at).getTime();
    if (ageMs < 12 * 3600_000) continue; // give himself time to handle it
    signals.push({
      key: `watch:email:${e.id}`,
      id: nextId(),
      kind: "email_action",
      text: `Unhandled email needing action from ${e.sender} (${e.mailbox}): "${e.subject}"${e.summary ? ` — ${e.summary}` : ""}.`,
    });
  }

  return signals.slice(0, MAX_SIGNALS);
}

const JUDGE_SYSTEM = `You are DeanOS, Dean Ormsby's chief of staff. You are running a background "watch" pass — deciding whether anything below is worth interrupting Dean RIGHT NOW with a Telegram nudge.

Be extremely selective. Dean trusts these pings precisely because they are rare and always worth it. Silence is the correct, common answer. Only raise items that genuinely need his attention today and that he'd thank you for surfacing. Drop anything low-stakes, routine, or that can wait for the 9am brief.

If you raise anything, write ONE short, warm, specific Telegram message — plain text, no markdown headers. Lead with the single most important thing. Group naturally (e.g. "Two people are waiting on you: …"). Suggest the obvious next action where useful. Keep it tight — a few lines, not a report.

Return raise=false with an empty message when nothing clears the bar. Return the ids of exactly the signals you included in raised_ids.`;

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raise", "message", "raised_ids"],
  properties: {
    raise: { type: "boolean" },
    message: { type: "string", description: "The Telegram message, or empty string if raise is false." },
    raised_ids: { type: "array", items: { type: "string" }, description: "ids of the signals included." },
  },
} as const;

interface WatchResult {
  status: "silent" | "raised" | "no_signals" | "api_failed";
  sent?: string;
  raisedCount?: number;
  candidateCount: number;
}

/**
 * One watch pass: gather signals, suppress anything raised within the cooldown,
 * let the model decide (selectively) whether to nudge, send it, and mark what
 * was raised so it isn't repeated. Designed to run hourly during work hours.
 */
export async function runWatch(now: Date = new Date()): Promise<WatchResult> {
  const owner = await ensureOwner();
  const all = await gatherSignals(now);

  // Cooldown: drop signals already raised recently.
  const cutoff = now.getTime() - COOLDOWN_HOURS * 3600_000;
  const fresh: Signal[] = [];
  for (const s of all) {
    const last = await getLastSyncRun(s.key);
    if (last && last.getTime() > cutoff) continue;
    fresh.push(s);
  }
  if (fresh.length === 0) return { status: "no_signals", candidateCount: all.length };

  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const user = `Today is ${now.toISOString().slice(0, 10)}. Candidate signals:\n${fresh
    .map((s) => `[${s.id}] (${s.kind}) ${s.text}`)
    .join("\n")}`;
  const res = await callStructured({
    model,
    system: JUDGE_SYSTEM,
    user,
    schemaName: "watch_decision",
    jsonSchema: judgeSchema as unknown as Record<string, unknown>,
    maxOutputTokens: 800,
  });

  let parsed: { raise: boolean; message: string; raised_ids: string[] } | null = null;
  if (res.ok && res.rawText) {
    try {
      parsed = JSON.parse(res.rawText);
    } catch {
      parsed = null;
    }
  }

  await insertAiRun({
    userId: owner.user.id,
    promptName: "assistant-watch",
    promptVersion: WATCH_PROMPT_VERSION,
    model,
    input: { signals: fresh },
    rawOutput: res.rawText,
    parsedOutput: parsed,
    status: !res.ok ? "api_failed" : parsed ? "ok" : "parse_failed",
    error: res.ok ? null : res.error,
    usage: res.usage,
  });

  if (!res.ok || !parsed) return { status: "api_failed", candidateCount: all.length };
  if (!parsed.raise || !parsed.message.trim()) return { status: "silent", candidateCount: all.length };

  const ok = await sendToDean(parsed.message.trim());
  if (ok) {
    const raised = new Set(parsed.raised_ids);
    // Mark raised signals (fall back to all fresh if the model didn't echo ids).
    const toMark = fresh.filter((s) => raised.has(s.id));
    for (const s of toMark.length ? toMark : fresh) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: s.key, stats: { kind: s.kind } });
    }
  }
  return { status: "raised", sent: parsed.message.trim(), raisedCount: parsed.raised_ids.length, candidateCount: all.length };
}
