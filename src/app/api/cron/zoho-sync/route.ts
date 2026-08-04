import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { syncZohoTasks } from "@/lib/zoho/scoped";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refresh the cached Zoho Connect task list (one shared org connection). */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;
  const result = await syncZohoTasks();
  return NextResponse.json(result);
}
