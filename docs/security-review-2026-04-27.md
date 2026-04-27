# Security Review - 2026-04-27

## Executive Summary

I reviewed the Next.js 16 App Router backend, React frontend, CSP/proxy path, Docker/Kubernetes deployment files, CI, dependency audit output, and high-risk JavaScript sinks. I did not find a confirmed critical code-execution or direct secret-exposure issue in application code. The main risks are deployment and abuse-control gaps around public exposure of `/api/analyze`, which calls a paid upstream LLM provider.

Highest priority fixes:

1. Do not expose Docker Compose local-mode production on `0.0.0.0`.
2. Require Turnstile in public production unless an explicit local-only override is set.
3. Stop trusting `x-forwarded-for` in Kubernetes without an owned header-stripping ingress/proxy config.
4. Patch or override the vulnerable PostCSS dependency once compatibility is verified.

## Remediation Status

- `GC-SEC-001`: patched. Default Compose now runs through nginx, publishes only `127.0.0.1:7001`, exposes the app only on the internal compose network, and keeps local mode in `docker-compose.local.yml`.
- `GC-SEC-002`: patched. Public production now returns `503` when Turnstile is not configured; explicit local production can still run without Turnstile.
- `GC-SEC-003`: patched for the nginx ingress path. Kubernetes config now uses `x-real-ip`, and `k8s/ingress.yaml` overwrites forwarding headers before traffic reaches the app.
- `GC-SEC-004`: patched. Default Compose no longer loads `.env.local`; file-backed Docker secrets are used for sensitive production values.
- `GC-SEC-005`: patched with an npm `overrides` entry for `postcss@8.5.10`.
- `GC-SEC-006`: accepted low-risk compatibility exception. Production keeps `style-src-attr 'unsafe-inline'` because Framer Motion writes runtime SVG style attributes; production `script-src` remains nonce-based and does not allow inline script execution.

## Scope and Evidence

Reviewed:

- Request path: `app/api/analyze/route.ts`, `lib/request-guards.ts`, `lib/rate-limit.ts`, `lib/turnstile.ts`, `lib/runtime-env.ts`
- Security headers and CSP: `proxy.ts`, `lib/security-headers.ts`, `next.config.ts`, `app/layout.tsx`
- Frontend sinks and parsing: `components/`, `lib/validate-analysis.ts`, `lib/theme.ts`
- Deployment: `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `k8s/*.yaml`
- CI and dependencies: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `package.json`, `package-lock.json`

Commands run:

- `rg` scan for DOM/code execution sinks, secrets, env exposure, CORS/origin, redirect, and fetch patterns
- `npm audit --audit-level=high`
- `npm audit --audit-level=moderate --omit=dev`
- `npm ls postcss next --all`

## Findings

### GC-SEC-001 - High - Docker Compose exposes local-mode production on all interfaces

**Rule ID:** NEXT-DEPLOY-001 / public abuse-control baseline  
**Location:** `docker-compose.yml:10-27`, `lib/rate-limit.ts:68-70`, `lib/rate-limit.ts:222-226`, `lib/rate-limit.ts:238-260`, `README.md:92`

**Evidence:**

```yaml
ports:
  - "0.0.0.0:7001:7001"
environment:
  NODE_ENV: production
  DEPLOYMENT_MODE: local
```

`DEPLOYMENT_MODE=local` lets production use the in-memory limiter when Redis is absent:

```ts
if (isProduction() && !isLocalProductionDeployment()) {
  throw new RateLimitError("Shared rate-limit backend is required in production.");
}
return checkRateLimitInMemory(key, { limit, windowMs });
```

When no trusted proxy header is configured, the key falls back to the shared local bucket:

```ts
return LOCAL_KEY;
```

README claims the compose stack is fronted by nginx, published only on `127.0.0.1:7001`, and uses `TRUSTED_IP_HEADER=x-real-ip`, but the current compose file publishes the app directly on every interface.

**Impact:** Any host that can reach the machine can hit `/api/analyze` directly. Because local mode collapses requests into an in-process bucket, one remote client can deny service to everyone sharing that instance, and public exposure bypasses the documented proxy/IP-header design.

**Fix:** Split local and public deployment modes. Keep local compose bound to `127.0.0.1` and clearly local-only, or add the nginx service described in README, expose only nginx, strip client-supplied IP headers there, set `TRUSTED_IP_HEADER=x-real-ip`, and remove `DEPLOYMENT_MODE=local` from the public compose path.

**Mitigation:** Firewall port 7001 to loopback/private admin networks until the compose topology is corrected.

**False positive notes:** If this compose file is never used on a networked host, the risk is reduced. The current file itself is still unsafe to reuse as a public deployment template.

### GC-SEC-002 - High - Turnstile is optional in production for the paid analysis endpoint

**Rule ID:** abuse-control / bot mitigation fail-closed  
**Location:** `lib/turnstile.ts:52-56`, `app/api/health/route.ts:29-40`, `app/api/health/route.test.ts:40-49`, `app/api/analyze/route.ts:128-139`

**Evidence:**

```ts
const config = getTurnstileConfig(env)

if (!config) {
  // Turnstile is optional — if neither key is configured, skip verification.
  return
}
```

Health treats missing Turnstile as configured, disabled, and still serviceable:

```ts
turnstileConfigured = (!siteKey && !secretKey) || Boolean(siteKey && secretKey);
const canServeRequests = groqConfigured && turnstileConfigured;
```

There is a production health test expecting `200 degraded` when Groq is set but Redis/proxy are not configured.

**Impact:** A public production deployment can call Groq without a human challenge if both Turnstile keys are omitted. IP rate limiting helps, but distributed clients can still burn quota and degrade availability.

**Fix:** Require Turnstile in public production. Allow it to be disabled only in non-production or explicit local-only mode, for example `DEPLOYMENT_MODE=local` plus loopback binding. Update `/api/health` to return `503` when public production lacks Turnstile.

**Mitigation:** Configure both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` immediately in any public deployment.

**False positive notes:** If another edge bot-protection layer is enforced before the app, document that and add an explicit env flag naming the compensating control.

### GC-SEC-003 - Medium - Kubernetes trusts `x-forwarded-for` without an owned stripping/appending config

**Rule ID:** trusted client identity / rate-limit key integrity  
**Location:** `k8s/configmap.yaml:16-19`, `lib/rate-limit.ts:82-86`, `nginx.conf:6-10`, `k8s/networkpolicy.yaml:17-26`

**Evidence:**

```yaml
TRUSTED_IP_HEADER: "x-forwarded-for"
```

The app uses the rightmost value from comma-delimited headers:

```ts
const candidate = rawValue.split(",").at(-1)?.trim() ?? "";
```

The repo has an nginx config that strips client-supplied forwarding headers, but the Kubernetes manifests do not include an ingress/proxy config that proves the same behavior before traffic reaches the pod.

**Impact:** If the Kubernetes ingress appends to `X-Forwarded-For` or forwards an untrusted client value differently than expected, attackers may influence rate-limit bucketing and bypass per-client limits.

**Fix:** Use a dedicated sanitized header such as `x-client-ip` or `x-real-ip` set by an ingress/proxy configuration controlled in this repo. Ensure inbound copies are stripped before setting it. Update `TRUSTED_IP_HEADER` to that header and add a manifest or deployment doc proving the stripping behavior.

**Mitigation:** Verify the live ingress behavior with requests carrying spoofed `X-Forwarded-For` values before public launch.

**False positive notes:** Some managed ingress controllers can be configured to overwrite this safely, but that configuration is not visible in this repo.

### GC-SEC-004 - Medium - Compose `env_file` can override Docker secrets because direct env values win

**Rule ID:** NEXT-SECRETS-001 / secret handling consistency  
**Location:** `docker-compose.yml:30-41`, `lib/runtime-env.ts:22-29`

**Evidence:**

Compose includes `.env.local`:

```yaml
env_file:
  - .env.local
```

Runtime config prefers direct environment variables over file-backed secrets:

```ts
const directValue = env[name]?.trim()
if (directValue) {
  return directValue
}
```

**Impact:** If `.env.local` contains real secrets, production compose uses process environment values instead of Docker secrets. This weakens the intended secret handling model and can create confusing drift between local, compose, and production behavior.

**Fix:** Use a compose-specific non-secret env file, for example `.env.compose`, or change production runtime secret resolution to prefer `*_FILE` for sensitive names when both are present. Add a test for precedence.

**Mitigation:** Keep secrets out of `.env.local` for compose runs and verify `docker compose config` before deploying.

**False positive notes:** `.env.local` is gitignored, so this is not a repository secret leak by itself.

### GC-SEC-005 - Medium - Production dependency audit reports vulnerable PostCSS versions

**Rule ID:** NEXT-SUPPLY-001 / dependency advisory handling  
**Location:** `package.json:13-33`, `package-lock.json:2046`, `package-lock.json:6075`, `package-lock.json:7795`

**Evidence:**

`npm audit --audit-level=moderate --omit=dev` reports:

```text
postcss <8.5.10
Severity: moderate
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output
node_modules/next/node_modules/postcss
```

`npm ls postcss next --all` shows:

```text
@tailwindcss/postcss@4.2.2 -> postcss@8.5.9
vite@8.0.8 -> postcss@8.5.9
next@16.2.4 -> postcss@8.4.31
```

**Impact:** The advisory is an XSS class in CSS stringification. Exploitability appears limited here because the app does not process attacker-controlled CSS at runtime, but the dependency remains flagged in production audit output.

**Fix:** Prefer upgrading affected packages when patched versions are available. If upstream packages lag, test an npm `overrides` entry for `postcss@8.5.10` or newer, then run full tests/build and `npm audit --audit-level=moderate --omit=dev`.

**Mitigation:** Keep the high-severity audit gate, add a moderate audit review job, and document any temporary advisory acceptance with rationale and expiry.

**False positive notes:** `npm audit fix --force` suggests a nonsensical downgrade to `next@9.3.3`; do not use that blindly.

### GC-SEC-006 - Low - CSP still permits inline style attributes in production

**Rule ID:** REACT frontend CSP hardening  
**Location:** `lib/security-headers.ts:43-46`, component inline style usage in `components/GoldenCircle.tsx`, `components/LoadingState.tsx`, and `components/GoldenCircleApp.tsx`

**Evidence:**

```ts
...(safeNonce ? ["style-src-attr 'unsafe-inline'"] : []),
```

Several components use React `style={{ ... }}` for dynamic SVG transform origins and themed CSS variable backgrounds.

**Impact:** This is not a direct vulnerability by itself, but it weakens CSP defense-in-depth. If another XSS sink appears later, inline style attributes remain available.

**Fix:** Move dynamic styles to CSS custom properties and classes where practical. Then remove `style-src-attr 'unsafe-inline'` in production and keep it only in development if needed.

**Mitigation:** Keep the existing strict `script-src` nonce and continue avoiding untrusted HTML sinks.

**False positive notes:** React style props do not execute JavaScript URLs the way raw HTML event handlers do; this is a hardening gap, not an immediate exploit path.

## Positive Controls Observed

- `/api/analyze` enforces JSON content type, origin allowlist, request body byte limit, input length limit, upstream timeout, and generic client errors.
- Production rate limiting fails closed unless a shared backend is configured, except for explicit local mode.
- Runtime secret file paths are restricted to `/run/secrets` and `/var/secrets` in production.
- CSP, `frame-ancestors`, `X-Frame-Options`, `nosniff`, referrer policy, permissions policy, COOP, and CORP are configured.
- Docker image uses a pinned Node digest, non-root runtime user, read-only compose filesystem, dropped capabilities, and no-new-privileges.
- Kubernetes disables service-account token mounting and drops capabilities.
- CI pins GitHub Actions by SHA, runs tests/lint/type-check, audits high-severity production dependencies, and runs Trivy gates for high/critical issues.

## Recommended Priority

1. Patch GC-SEC-001 and GC-SEC-002 before any public exposure.
2. Patch GC-SEC-003 before Kubernetes/EKS exposure.
3. Patch or document GC-SEC-005 during dependency maintenance.
4. Address GC-SEC-004 with the compose topology change.
5. Treat GC-SEC-006 as defense-in-depth cleanup after the abuse-control fixes.
