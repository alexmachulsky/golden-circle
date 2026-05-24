# Threat Model — Golden Circle Analyzer

_Last reviewed: 2026-05-24. This is the canonical, current threat model. Dated
`docs/security-review-*.md` files are retained as historical provenance._

## System overview

A single-page Next.js app. The only state-changing entry point is
`POST /api/analyze`, which proxies a sanitized business-idea string to the Groq
LLM and streams the response back. There is no user database, no authentication,
and no persistent user data — the only stored state is a short-lived response
cache keyed by a hash of the sanitized input.

## Trust boundaries

| Boundary | Untrusted input | Control |
| --- | --- | --- |
| Browser → `/api/analyze` | request body, headers, origin | 6-guard chain (below) |
| Reverse proxy → app | client IP header | `TRUSTED_IP_HEADER`; nginx strips client-supplied IP headers |
| App → Groq | sanitized prompt | input sanitization + length caps + prompt-injection sentinel scan |
| Groq → Browser | LLM output | `__ERROR__` preamble scan; client re-validates JSON shape |
| Shared link → app | `#data=` URL hash | size cap (8 KB) + `parseAnalysis` re-validation |

## Request-guard chain (`/api/analyze`)

Executed in order; each returns a JSON error with the correct status before any
LLM call:

1. **Content-Type** — must be `application/json` (415).
2. **Origin** — must match `ALLOWED_ORIGINS` (403).
3. **Rate limit** — per-client token bucket; fails closed in public production
   without shared Upstash + trusted IP header (429 / 503).
4. **Body size** — 8 KB cap before parsing (413).
5. **API key** — `GROQ_API_KEY` presence (500 if missing).
6. **Human verification** — optional Cloudflare Turnstile, with action +
   hostname binding; fails closed in public production if misconfigured (503).

## Key risks & mitigations

- **Prompt injection / sentinel forgery** — the server buffers the stream
  preamble and rejects an LLM response that tries to emit the `__ERROR__`
  sentinel; the cache never stores `__ERROR__` payloads.
- **XSS** — strict CSP with per-request nonce (`script-src 'self' 'nonce-…'`);
  React escaping; output sanitizer strips control/bidi characters. Only
  `style-src-attr 'unsafe-inline'` remains (Framer Motion runtime styles).
- **Clickjacking** — `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
- **IP spoofing for rate-limit evasion** — nginx overwrites client-supplied IP
  headers; only the proxy-injected `TRUSTED_IP_HEADER` is trusted.
- **Secret exposure** — secrets read on demand via `*_FILE` Docker secrets
  restricted to `/run/secrets`|`/var/secrets` in production; never baked into the
  image; CI runs gitleaks + restricts token permissions (least privilege).
- **Supply chain** — pinned base-image digest, `npm ci --ignore-scripts`,
  SHA-pinned GitHub Actions, Trivy image scan (CRITICAL/HIGH gate), CodeQL SAST,
  SBOM + SLSA provenance on publish, Dependabot, OpenSSF Scorecard.
- **Untrusted shared-link data** — decoded `#data=` payload is size-capped and
  re-validated through the same `parseAnalysis` schema as live responses.

## Residual risk / accepted exceptions

- `style-src-attr 'unsafe-inline'` is accepted to support Framer Motion runtime
  `style=` attributes; script execution remains nonce-only.
- `DEPLOYMENT_MODE=local` intentionally relaxes the rate-limiter and proxy
  requirements for loopback/LAN use only (documented, not for public exposure).
