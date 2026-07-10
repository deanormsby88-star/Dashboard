import { NextResponse, type NextRequest } from "next/server";
import { ingestCircleback } from "@/lib/ingest/circleback";
import { headersWithQuerySecret } from "@/lib/webhooks/request";

export const runtime = "nodejs";
// Meeting Processor runs inline (OpenAI call), so allow up to 60s.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const result = await ingestCircleback(headersWithQuerySecret(request), rawBody);
  return NextResponse.json(result.body, { status: result.status });
}
