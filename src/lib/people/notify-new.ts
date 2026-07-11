import { appendConversationMessage } from "@/lib/db/repo";
import { sendToDean } from "@/lib/telegram/notify";
import type { Person } from "@/lib/types";

/**
 * When a new contact is auto-discovered, ask Dean (on Telegram) for a bio.
 * The prompt is also recorded in the Telegram conversation memory so his
 * reply ("she's the ops manager at…") has the context to update the profile.
 * No-op when Telegram isn't configured.
 */
export async function notifyNewPerson(
  userId: string,
  person: Person,
  businessName?: string | null
): Promise<void> {
  const label = businessName ? ` (${businessName})` : "";
  const msg = `👤 New contact picked up: ${person.full_name}${label}.\n\nWant to give me a quick bio? Reply here — text or voice — with their role, company, and anything worth remembering, and I'll add it to their profile.`;
  const sent = await sendToDean(msg);
  if (sent) {
    await appendConversationMessage({ userId, channel: "telegram", role: "assistant", content: msg }).catch(
      () => {}
    );
  }
}
