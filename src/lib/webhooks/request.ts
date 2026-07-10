import type { NextRequest } from "next/server";
import { SECRET_HEADER } from "@/lib/webhooks/security";

/**
 * Some senders (e.g. Circleback's native webhook automation) can't set
 * custom headers. Allow the shared secret as a ?secret= query parameter as
 * a fallback: if the header is absent but the param is present, promote it
 * to the header so the ingestion pipeline sees one canonical shape.
 * Trade-off documented in SECURITY.md.
 */
export function headersWithQuerySecret(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  if (!headers.get(SECRET_HEADER)) {
    const fromQuery = request.nextUrl.searchParams.get("secret");
    if (fromQuery) headers.set(SECRET_HEADER, fromQuery);
  }
  return headers;
}
