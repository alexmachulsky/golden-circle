/**
 * Receives Content-Security-Policy violation reports from browsers.
 *
 * Browsers send a POST with Content-Type: application/reports+json (Reporting API v1)
 * when the CSP `report-to` directive triggers. Violations are logged to the server
 * so active XSS attempts or policy misconfigurations become visible.
 *
 * No auth needed — this endpoint accepts anonymous browser reports only.
 * The body is capped to prevent abuse.
 */

const MAX_REPORT_BYTES = 8 * 1024; // 8 KB

export async function POST(req: Request) {
  try {
    const cl = req.headers.get("content-length");
    if (cl && parseInt(cl, 10) > MAX_REPORT_BYTES) {
      return new Response(null, { status: 204 });
    }

    const raw = await req.text();
    if (raw.length > MAX_REPORT_BYTES) {
      return new Response(null, { status: 204 });
    }

    // Log the raw report — structured logging picks this up in prod.
    console.warn("[csp-report]", raw.slice(0, 2000));
  } catch {
    // Never surface errors to the browser for this endpoint.
  }

  return new Response(null, { status: 204 });
}
