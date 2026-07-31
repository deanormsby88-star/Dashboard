import { NextResponse, type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildDisplayData } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only dashboard JSON for an external display (SenseCraft etc.). Auth by a
 * stable device token, accepted either as `Authorization: Bearer <token>` or
 * `?token=<token>`. Returns flat, display-ready fields. No cookies, no writes.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const token = (bearer ?? request.nextUrl.searchParams.get("token") ?? "").trim();

  const userId = token ? verifyDisplayToken(token) : null;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const owner = await getUserById(userId).catch(() => null);
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await buildDisplayData(owner);
  // Cache briefly at the edge so a polling panel can't hammer the DB.
  return NextResponse.json(data, {
    headers: { "cache-control": "public, max-age=60" },
  });
}
