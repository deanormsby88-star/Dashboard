import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.todoist.com/api/v1";

/**
 * Diagnose Todoist pushing end-to-end from the prod environment: is the token
 * present + valid, what project IDs are stored, and does a live create succeed
 * (into the Heya project and the Inbox). Test tasks are deleted. Open in the
 * browser while logged in.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const token = getEnv().TODOIST_API_TOKEN;
  const owner = await ensureOwner();
  const out: Record<string, unknown> = {
    tokenPresent: Boolean(token),
    businesses: owner.businesses.map((b) => ({ key: b.key, todoist_project_id: b.todoist_project_id })),
  };
  if (!token) return NextResponse.json({ ...out, verdict: "TODOIST_API_TOKEN is not set in the environment." });

  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const hfetch = async (path: string, init?: RequestInit) => {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
      const text = await res.text().catch(() => "");
      return { status: res.status, ok: res.ok, body: text.slice(0, 300) };
    } catch (err) {
      return { status: 0, ok: false, body: err instanceof Error ? err.message : String(err) };
    }
  };

  out.auth = await hfetch("/tasks?limit=1");

  const heya = owner.businesses.find((b) => b.key === "heya");
  const testCreate = async (label: string, projectId?: string | null) => {
    const body: Record<string, unknown> = { content: `__DeanOS diagnose ${label}__`, priority: 1 };
    if (projectId) body.project_id = projectId;
    const res = await fetch(`${BASE}/tasks`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text().catch(() => "");
    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { id?: string }).id;
    } catch {
      /* ignore */
    }
    if (id) await fetch(`${BASE}/tasks/${id}`, { method: "DELETE", headers }).catch(() => {});
    return { status: res.status, ok: res.ok, created: Boolean(id), error: res.ok ? undefined : text.slice(0, 300) };
  };

  out.createInHeyaProject = await testCreate("heya", heya?.todoist_project_id);
  out.createInInbox = await testCreate("inbox", null);
  return NextResponse.json(out);
}
