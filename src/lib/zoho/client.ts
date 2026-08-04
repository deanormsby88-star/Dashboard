import { getEnv } from "@/lib/env";

/**
 * Zoho Connect (Heya's shared task boards). Reverse-engineered against the
 * live API — Zoho does not publicly document this exact shape. Confirmed live:
 *   Auth:    POST https://accounts.zoho.com/oauth/v2/token (refresh_token grant)
 *   Reads:   GET  https://connect.zoho.com/pulse/api/{action}?scopeID=...
 *     myBoards                                   -> { myBoards: { boards: [...] } }
 *     boardSections?boardId=                     -> { boardSections: { sections: [...] } }
 *     sectionTasks?boardId=&sectionId=           -> { sectionTasks: { tasks: [...] } }
 * There is no flat "all tasks" endpoint — listAllTasks() walks boards → sections → tasks.
 */

const ACCOUNTS = "https://accounts.zoho.com/oauth/v2/token";
const API = "https://connect.zoho.com/pulse/api";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function zohoConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN && env.ZOHO_SCOPE_ID);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const env = getEnv();
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) {
    throw new Error("Zoho not configured (ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN missing).");
  }
  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch(ACCOUNTS, { method: "POST", body: params, cache: "no-store" });
  if (!res.ok) throw new Error(`Zoho token refresh failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`Zoho token refresh error: ${data.error ?? "no access_token in response"}`);

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function call<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const token = await getAccessToken();
  const scopeID = getEnv().ZOHO_SCOPE_ID;
  const q = new URLSearchParams({ scopeID: scopeID ?? "", ...params });
  const res = await fetch(`${API}/${action}?${q.toString()}`, {
    headers: { authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Zoho ${action}: non-JSON response (HTTP ${res.status})`);
  }
  const wrapped = body[action] as { result?: string; reason?: string } | undefined;
  if (!res.ok || wrapped?.result === "failure") {
    throw new Error(`Zoho ${action} failed: ${wrapped?.reason ?? res.status}`);
  }
  return body as T;
}

export interface ZohoBoard {
  id: string;
  name: string;
}

export async function listBoards(): Promise<ZohoBoard[]> {
  const res = await call<{ myBoards: { boards: ZohoBoard[] } }>("myBoards");
  return res.myBoards.boards ?? [];
}

export interface ZohoSection {
  id: string;
  name: string;
  taskCount: number;
}

export async function listSections(boardId: string): Promise<ZohoSection[]> {
  const res = await call<{ boardSections: { sections: Array<{ id: string; name: string; taskCount?: string }> } }>(
    "boardSections",
    { boardId }
  );
  return (res.boardSections.sections ?? []).map((s) => ({ id: s.id, name: s.name, taskCount: Number(s.taskCount ?? 0) }));
}

export interface ZohoTask {
  id: string;
  title: string;
  statusName: string;
  priorityName: string;
  assignees: Array<{ email: string; name: string }>;
  dueDate: string | null; // YYYY-MM-DD
  isOverdue: boolean;
  isCompleted: boolean;
  boardId: string;
  boardName: string;
  sectionId: string;
  sectionName: string;
  url: string | null;
}

interface RawZohoTask {
  id: string;
  title: string;
  taskStatus?: { name?: string };
  taskPriority?: { name?: string };
  assignees?: Array<{ email?: string; name?: string }>;
  endDateLong?: string;
  isOverDue?: string;
  isCompleted?: string;
  section?: { id?: string; name?: string; url?: string };
}

function mapTask(raw: RawZohoTask, boardId: string, boardName: string): ZohoTask {
  const dueMs = raw.endDateLong ? Number(raw.endDateLong) : null;
  return {
    id: raw.id,
    title: raw.title,
    statusName: raw.taskStatus?.name ?? "Open",
    priorityName: raw.taskPriority?.name ?? "None",
    assignees: (raw.assignees ?? []).map((a) => ({ email: a.email ?? "", name: a.name ?? "Unknown" })),
    dueDate: dueMs && Number.isFinite(dueMs) ? new Date(dueMs).toISOString().slice(0, 10) : null,
    isOverdue: raw.isOverDue === "true",
    isCompleted: raw.isCompleted === "true",
    boardId,
    boardName,
    sectionId: raw.section?.id ?? "",
    sectionName: raw.section?.name ?? "",
    url: raw.section?.url ?? null,
  };
}

export async function listSectionTasks(boardId: string, boardName: string, sectionId: string): Promise<ZohoTask[]> {
  const res = await call<{ sectionTasks: { tasks: RawZohoTask[] } }>("sectionTasks", { boardId, sectionId });
  return (res.sectionTasks.tasks ?? []).map((t) => mapTask(t, boardId, boardName));
}

/**
 * Every task across every board/section. No flat endpoint exists, so this
 * walks the full board → section → task tree. Sections with zero tasks are
 * skipped via taskCount to cut calls where possible.
 */
export async function listAllTasks(): Promise<ZohoTask[]> {
  const boards = await listBoards();
  const out: ZohoTask[] = [];
  for (const board of boards) {
    const sections = await listSections(board.id);
    for (const section of sections) {
      if (section.taskCount === 0) continue;
      const tasks = await listSectionTasks(board.id, board.name, section.id);
      out.push(...tasks);
    }
  }
  return out;
}
