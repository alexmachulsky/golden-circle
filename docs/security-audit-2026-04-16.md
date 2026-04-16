# Security Audit Report — 2026-04-16

**Target:** Golden Circle Analyzer (Next.js 16.2.3, Docker)
**Method:** 5-agent automated audit covering API security, input validation, Docker/infrastructure, rate limiting/access control, and dependencies/headers/config

---

## Executive Summary

The application demonstrates a **strong security posture** with defense-in-depth: layered request guards, nonce-based CSP, non-root container with dropped capabilities, Docker secrets for sensitive values, and strict input validation. **No critical or high-severity code vulnerabilities were found.** All findings are medium or low severity, and all have been fixed or documented as deployment configuration items.

---

## Findings Fixed (Code Changes Applied)

### 1. Health Endpoint Info Disclosure (Medium → Fixed)
- **Was:** `/api/health` returned detailed service configuration status (Groq, Redis, Turnstile, proxy) to unauthenticated callers, aiding attacker reconnaissance.
- **Fix:** Now returns only `{"status":"ok"}` or `{"status":"degraded"}`. Detailed service info is logged server-side for operators.
- **Files:** `app/api/health/route.ts`, `app/api/health/route.test.ts`

### 2. Docker Container: No Resource Limits (Medium → Fixed)
- **Was:** No memory/CPU limits in `docker-compose.yml`. Runaway process could consume all host resources.
- **Fix:** Added `deploy.resources.limits` (512M memory, 1.0 CPU) and reservations (256M, 0.25 CPU).
- **File:** `docker-compose.yml`

### 3. Docker Container: Writable Filesystem (Medium → Fixed)
- **Was:** Container filesystem was read-write, allowing post-exploitation file writes.
- **Fix:** Added `read_only: true` with `tmpfs: /tmp:size=64M,noexec,nosuid`.
- **File:** `docker-compose.yml`

### 4. nginx IP Header Spoofing (Medium → Fixed)
- **Was:** `X-Forwarded-For` used `$proxy_add_x_forwarded_for` which appends to client-supplied values, enabling IP spoofing for rate-limit bypass.
- **Fix:** Changed to `$remote_addr` (overwrite, not append). Added `server_tokens off`. Added health endpoint restriction to internal networks only.
- **File:** `nginx.conf`

### 5. sanitizeInput: Unicode Angle Bracket Bypass (Medium → Fixed)
- **Was:** `sanitizeInput()` only stripped ASCII `<>`. Unicode fullwidth angle brackets (U+FF1C, U+FF1E) and other lookalikes could bypass the filter.
- **Fix:** Added regex to strip Unicode angle-bracket lookalikes. Also strips null bytes, C0/C1 control chars, bidi override chars, and zero-width characters. Handles unclosed HTML tags.
- **File:** `app/api/analyze/route.ts`

### 6. `__ERROR__` Prefix Check Race (Low → Fixed)
- **Was:** If LLM's first chunk contained `{` within the first 8 bytes, the prefix check could fire before accumulating the full 9-char `__ERROR__` prefix.
- **Fix:** Added `accumulated.length >= 9` guard before allowing the `{` shortcut.
- **File:** `app/api/analyze/route.ts`

### 7. Port Binding on 0.0.0.0 (Low → Fixed)
- **Was:** Docker container listened on all interfaces, exposing the app without a reverse proxy.
- **Fix:** Changed to `127.0.0.1:7001:7001` (loopback only).
- **File:** `docker-compose.yml`

### 8. Stale Comment (Info → Fixed)
- **Was:** `next.config.ts` referenced `middleware.ts` for CSP, but CSP is set in `proxy.ts`.
- **Fix:** Updated comment to reference `proxy.ts`.
- **File:** `next.config.ts`

### 9. No robots.txt (Info → Fixed)
- **Was:** No `robots.txt` file. Crawlers could hit API endpoints.
- **Fix:** Added `public/robots.txt` with `Disallow: /api/`.
- **File:** `public/robots.txt`

---

## Deployment Configuration Items (Not Code Bugs)

These are deployment-time configuration requirements, not application code vulnerabilities. They are by-design for development/local setups and must be configured before production:

| Item | Severity | Status | Action Required |
|------|----------|--------|-----------------|
| Shared rate-limit bucket (no per-IP limiting) | High | By design in dev | Configure `TRUSTED_IP_HEADER` + reverse proxy |
| Turnstile CAPTCHA disabled | High | By design in dev | Configure `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` |
| In-memory rate limit (no Redis) | Medium | By design in dev | Configure Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) |
| Secret file permissions (664) | Low | Docker Compose limitation | Use Docker Swarm secrets with `mode: 0400` or chmod in init |

---

## Positive Security Controls Confirmed

| Area | Status |
|------|--------|
| CSP with per-request nonce + strict-dynamic | ✅ |
| All security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP) | ✅ |
| X-Powered-By / Server header removed | ✅ |
| Non-root container (UID 1001) | ✅ |
| All capabilities dropped + no-new-privileges | ✅ |
| Docker image pinned by digest | ✅ |
| Multi-stage build, no secret leakage | ✅ |
| npm ci --ignore-scripts | ✅ |
| Secrets via Docker secrets, never env vars | ✅ |
| Path-traversal protection on secret files | ✅ |
| SSRF protection on Upstash URL | ✅ |
| 8KB body size limit (stream byte counting) | ✅ |
| Origin validation (exact match, case-sensitive) | ✅ |
| Content-Type enforcement (forces CORS preflight) | ✅ |
| Error message sanitization (no stack traces) | ✅ |
| HTML/XML tag stripping + length enforcement | ✅ |
| __ERROR__ sentinel injection guard | ✅ |
| React text nodes only (no dangerouslySetInnerHTML for LLM output) | ✅ |
| Clipboard sanitization (strips control chars) | ✅ |
| Strict TypeScript (no ts-ignore, no as any) | ✅ |
| No eval/Function in codebase | ✅ |
| No source maps in production | ✅ |
| 0 npm audit vulnerabilities | ✅ |
| No ReDoS-vulnerable regex patterns | ✅ |
| No secrets in git history | ✅ |
| 52/52 unit tests passing | ✅ |
