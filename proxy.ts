import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/security-headers";

/**
 * Generate a cryptographically random base64 nonce.
 * Uses the Web Crypto API which is available in both Edge Runtime and Node.js 16+.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa + spread is safe for 16 bytes (well within call-stack limits)
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Per-request proxy that:
 *  1. Generates a fresh CSP nonce.
 *  2. Forwards the nonce to Server Components via the x-nonce request header.
 *  3. Sets the Content-Security-Policy response header with the nonce.
 *
 * All other security headers are set statically in next.config.ts.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();

  // Propagate nonce to Server Components (readable via `headers()` from next/headers)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(process.env, nonce),
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except Next.js internals and static public assets.
     * This ensures every HTML page response carries a unique nonce.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)",
  ],
};
