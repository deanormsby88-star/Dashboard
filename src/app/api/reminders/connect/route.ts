import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { encryptSecret } from "@/lib/crypto";
import { getReminderConnection, upsertReminderConnection } from "@/lib/db/repo";
import { listReminderLists } from "@/lib/reminders/caldav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connect Apple Reminders: verify the Apple ID + app-specific password by
 * listing the account's Reminders lists, store the credential encrypted, and
 * return the lists so the user can pick the one DeanOS should use.
 */
export async function POST(request: NextRequest) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const body = (await request.json().catch(() => null)) as { appleId?: string; appPassword?: string } | null;
  const appleId = body?.appleId?.trim();
  const appPassword = body?.appPassword?.trim();
  if (!appleId || !appPassword) {
    return NextResponse.json({ error: "Enter your Apple ID and app-specific password." }, { status: 400 });
  }

  let lists;
  try {
    lists = await listReminderLists(appleId, appPassword);
  } catch {
    return NextResponse.json(
      { error: "Couldn't sign in to iCloud. Check the Apple ID and that this is an app-specific password (not your main one)." },
      { status: 400 }
    );
  }

  await upsertReminderConnection({ userId: owner.user.id, username: appleId, appPasswordEnc: encryptSecret(appPassword) });

  const existing = await getReminderConnection(owner.user.id);
  return NextResponse.json({ ok: true, lists, selected: existing?.list_url ?? null });
}
