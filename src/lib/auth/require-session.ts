import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Guard for API route handlers and server components. Middleware already
 * gates these paths; this is defense in depth and gives routes the caller
 * identity.
 */
export async function getSessionEmail(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token, getEnv().SESSION_SECRET);
  return session?.email ?? null;
}

export async function requireSession(): Promise<{ email: string } | Response> {
  const email = await getSessionEmail();
  if (!email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { email };
}
