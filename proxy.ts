import { NextRequest, NextResponse } from "next/server";

/**
 * Generates a cryptographically random nonce (128-bit, base64-encoded) and
 * injects it into:
 *  - the forwarded request headers (so layout.tsx can read it via headers())
 *  - the Content-Security-Policy response header
 *
 * CSP design notes:
 *  - script-src uses 'nonce-<N>' + 'strict-dynamic' so only nonce'd scripts
 *    (the inline theme bootstrap) and scripts loaded by them are trusted.
 *  - style-src keeps 'unsafe-inline' because Framer Motion and Tailwind emit
 *    inline styles at runtime — this does not weaken script-src.
 *  - frame-ancestors 'none' supplements X-Frame-Options: DENY (belt + braces).
 *  - report-to sends CSP violation reports to /api/csp-report so active
 *    XSS attempts and policy violations are visible in server logs.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-to csp-violations",
  ].join("; ");

  // Forward the nonce to the server component tree via a request header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", csp);
  // Declare the reporting endpoint that CSP report-to references above.
  response.headers.set(
    "Reporting-Endpoints",
    'csp-violations="/api/csp-report"',
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets that don't need CSP.
     * This keeps the middleware off the hot path for _next/static files.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
