import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { getUserById, type Owner } from "@/lib/db/repo";

/**
 * Resolve the CURRENT request's user from the session cookie — the multi-user
 * replacement for ensureOwner() in request-scoped code (pages + API routes).
 * Returns null when there's no valid session or the user no longer exists.
 *
 * Middleware already gates these paths, so a null here means an edge case
 * (expired/legacy cookie, deleted user) and the caller should 401 / redirect.
 */
export async function getSessionUser(): Promise<Owner | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token, getEnv().SESSION_SECRET);
  if (!session) return null;
  return getUserById(session.userId);
}

/** Same as getSessionUser but returns a 401 Response when unauthenticated,
 *  for API routes that want a hard guard. */
export async function requireUser(): Promise<Owner | Response> {
  const owner = await getSessionUser();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return owner;
}

/** For server components/pages: resolve the user or redirect to /login. */
export async function pageUser(): Promise<Owner> {
  const owner = await getSessionUser();
  if (!owner) redirect("/login");
  return owner;
}
