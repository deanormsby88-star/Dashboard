# Assumptions

Decisions made while building Phase 1 that were not fully specified in the
brief, recorded per §28. Flag anything here that should change.

1. **Auth is email/password, not magic link.** The brief allowed either.
   Password (scrypt hash in env) avoids depending on an email-sending
   service in Phase 1. Swapping to Supabase magic links later is contained
   in `src/lib/auth/`.

2. **Postgres is accessed directly via `pg` with SQL migrations**, not
   Supabase client libraries or an ORM. Works identically against
   Supabase-hosted Postgres (use the connection pooler URL on Vercel).
   Supabase auth/storage/realtime can be adopted later without schema
   changes; the `NEXT_PUBLIC_SUPABASE_*` variables from the brief are
   documented but unused in Phase 1.

3. **shadcn/ui and TanStack Query are not yet included.** Phase 1 screens
   are server components with small client islands; plain Tailwind
   components keep the dependency surface minimal. Both can be introduced
   when the UI grows (Phase 2+) without rework.

4. **The Meeting Processor runs inline in the webhook request**
   (`maxDuration 60s`) rather than via a queue. Smallest reliable
   end-to-end path; the ingest/process split makes moving to a queue table
   + scheduled worker straightforward if transcripts get very long.

5. **Zapier Catch Hooks can't return the created Todoist task
   synchronously**, so Zap 2 includes a callback step that POSTs the
   Todoist task ID/URL back to `/api/webhooks/zapier/todoist`. Task status
   flow: suggested → approved → sent → created.

6. **Waiting-on items become both a `to_dean` commitment and a suggested
   "Follow up:" task** (per §4.3's naming rule), which Dean approves like
   any other task.

7. **Default OpenAI model is `gpt-4.1`** via
   `OPENAI_MODEL_MEETING_PROCESSOR`; change per environment without code.

8. **Title-similarity threshold for deduplication is 0.75** (token-set
   Jaccard on normalized titles), pinned by unit tests. Tune with real
   meeting data.

9. **Meeting classification into Heya/JIC/Personal is done by the model**
   from meeting content, with `unknown` allowed; Dean can reassign the
   business on a task before approving. No attendee-domain heuristics yet —
   revisit in Phase 2/3 when people profiles exist.

10. **Retention rules are manual in Phase 1.** Raw payloads and transcripts
    are kept for provenance; automated retention/deletion policies arrive
    with Phase 2 (see SECURITY.md).

11. **Unauthenticated webhook requests are rejected without being stored.**
    "Never silently discard an event" is interpreted as applying to
    authenticated events; storing unauthenticated junk would let anyone
    fill the database.

12. **The repo keeps its existing name (`Dashboard`)**; the previous
    Microsoft-Graph dashboard prototype it contained was replaced by
    DeanOS on this branch (history is preserved in git).

13. **The Personal Todoist project maps to the Inbox** (empty project_id)
    until a validated Personal project ID exists, exactly as the brief
    specifies.

## Phase 2 (email)

14. **Dean's mailbox→business map is a code constant**
    (`src/lib/email/schema.ts`): deano@heya.team → Heya,
    dean@justimagineconsulting.co.za → JIC, dean.ormsby88@gmail.com →
    Personal. Used to infer mailbox context and direction when a Zap omits
    them; each Zap also sets `mailbox` explicitly.

15. **Email ingestion is folder/label driven, not full-mailbox.** Only
    emails moved to the `DeanOS` folder (Outlook) or label (Gmail) are
    processed, per the brief's "do not ingest entire mailbox histories".

16. **Email bodies are stored truncated (20k chars, HTML stripped)** and
    only the first 6k go to OpenAI. The mail platform remains the archive.

17. **Waiting-on resolution is automatic.** When an inbound email
    substantively delivers what an open waiting-on item awaited, the
    commitment is marked done and its follow-up task is completed in
    Todoist (when the complete hook is configured) without a review step.
    The prompt is instructed to be conservative (acknowledgments don't
    resolve); revisit if it over-resolves in practice.

18. **Derived message IDs**: when a mail integration doesn't expose a
    message ID, a deterministic one is derived from sender + subject +
    date + body prefix, keeping replays idempotent.

19. **Todoist reconciliation beyond completion callbacks** (two-way sync of
    edits made inside Todoist) is deferred to a later phase; the Zap 4
    callback already reflects completions done in Todoist.
