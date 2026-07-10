import { NextResponse, type NextRequest } from "next/server";
import { ingestEmail } from "@/lib/ingest/email";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const result = await ingestEmail(request.headers, rawBody);
  return NextResponse.json(result.body, { status: result.status });
}
