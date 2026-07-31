import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { signDisplayToken } from "@/lib/display/token";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Return the signed-in user's display API URL + Bearer token, to paste into an
 * external panel's config. Session-authed (only the owner can mint their own).
 */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const token = signDisplayToken(owner.user.id);
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return NextResponse.json({
    ok: true,
    // Paste this into the panel's "API URL" (token in the URL) …
    url: `${base}/api/display?token=${token}`,
    // … or use the plain URL with an Authorization header instead:
    url_no_token: `${base}/api/display`,
    header: { Authorization: `Bearer ${token}` },
    // A fully-rendered dashboard IMAGE — point an image widget at this (add
    // &w=&h= to match your screen, e.g. &w=480&h=480):
    image_url: `${base}/api/display/image?token=${token}`,
    token,
  });
}
