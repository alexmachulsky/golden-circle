# Golden Circle Security Review

Date: 2026-04-13  
Reviewer: GPT-5.4 via GitHub Copilot CLI

## Scope

Reviewed the application source and supporting security-relevant files, including:

- `app/api/analyze/route.ts`
- `components/GoldenCircleApp.tsx`
- `components/ResultSection.tsx`
- `components/InputForm.tsx`
- `components/ThemeToggle.tsx`
- `lib/theme.ts`
- `app/layout.tsx`
- `lib/prompt.ts`
- `types/index.ts`
- `next.config.ts`
- `proxy.ts`
- `lib/request-guards.ts`
- `lib/rate-limit.ts`
- `lib/validate-analysis.ts`
- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/ci.yml`
- `package.json`
- `.gitignore`
- `.dockerignore`

I also ran the requested runtime and dependency checks:

- `npm audit --audit-level=info`
- `git -C /home/alex/My-Projects/golden-circle ls-files .env.local`
- header probes against `http://localhost:7001/` and a locally started production server on `http://localhost:7010/`
- negative tests for `POST /api/analyze` with oversized, missing, malformed, and missing-field request bodies

## Executive Summary

The app already has several solid security controls: strict client-side rendering (no unsafe HTML sinks), nonce-based CSP in production, body-size limits, Origin checks, generic stream-time error masking, non-root container execution, and `.env*` exclusion from Git and Docker build context.

The most important issue is abuse protection around `POST /api/analyze`: the current limiter trusts client-supplied IP headers and stores counters only in-process. In practice, an attacker can cheaply bypass the limit and drive Groq usage/costs. Supply-chain hardening in CI/CD also needs improvement: the workflow trusts mutable GitHub Action tags, and the Dockerfile uses floating base-image tags.

---

## Findings

## High Severity

### 1. Client-controlled IP headers make `/api/analyze` rate limiting trivially bypassable

**Severity:** High  
**Title:** Spoofable IP-based limiter allows cost abuse and targeted throttling  
**File and line(s):** `app/api/analyze/route.ts:52-53`, `lib/rate-limit.ts:56-63`, `docker-compose.yml:10-18`

**Description**  
The server derives the rate-limit key directly from `x-forwarded-for`, then `x-real-ip`, before falling back to a constant. There is no trusted-proxy boundary or header scrubbing in front of the container. In the provided Docker Compose deployment, the Next.js app is published directly on `7001:7001`, so external clients can supply these headers themselves.

That means the paid LLM endpoint is effectively self-metered by attacker-chosen values. An attacker can rotate `X-Forwarded-For` on every request to bypass the per-minute cap, or deliberately set another user’s IP to consume that user’s budget and trigger 429s.

**Exploit scenario**  
I verified the bypass against the running production build on port `7010` without sending valid Groq requests:

```text
same-ip statuses tail: [400, 400, 429]
different-ip status: 400
different-ip body: {"error":"Invalid JSON body."}
```

The same malformed request hit 429 after repeated calls with one spoofed IP, then immediately succeeded again after changing only `X-Forwarded-For`.

**Recommendation**  
Do not trust client-supplied forwarding headers unless they are injected by a trusted reverse proxy that strips any inbound copies first. Use one of these patterns:

1. Terminate traffic at a trusted proxy/load balancer and overwrite a private header such as `x-client-ip`.
2. Reject requests when trusted client identity is unavailable.
3. Move rate limiting to a shared store (Redis/Upstash or edge/WAF rate limiting) so abuse control is not enforced inside the app process.

Example direction:

```ts
export function getClientKey(req: Request): string {
  const clientIp = req.headers.get("x-client-ip"); // set only by trusted proxy
  if (!clientIp) {
    throw new Error("Missing trusted client identity");
  }
  return clientIp;
}
```

At the infrastructure layer, strip inbound `X-Forwarded-For` / `X-Real-IP` from untrusted clients and have the proxy inject the authoritative client IP.

## Medium Severity

### 2. The current limiter is per-process only, so scale-out or restarts multiply the allowed budget

**Severity:** Medium  
**Title:** In-memory rate limiting is not production-grade for multi-instance deployments  
**File and line(s):** `app/api/analyze/route.ts:52-53`, `lib/rate-limit.ts:1-7`, `lib/rate-limit.ts:14-49`, `.env.local.example:9-10`

**Description**  
The limiter is backed by a local `Map` inside the Next.js process. The code comment correctly notes that this is per-replica only, but the endpoint currently relies on it as the only abuse-control mechanism before making paid upstream Groq calls.

In any scaled deployment, each replica gets its own independent budget. Process restarts also reset counters. This turns a nominal `20/minute` cap into `20 x number_of_replicas` and makes abuse control unreliable under autoscaling, rolling deploys, or serverless cold starts.

**Exploit scenario**  
If the app runs behind a load balancer with 3 replicas, a single attacker can often obtain roughly 60 requests/minute instead of 20 simply by continuing to send traffic and letting the balancer distribute requests. During rolling deploys or pod restarts, counters reset and the attacker regains fresh budget immediately.

**Recommendation**  
Back the limiter with a shared data store that supports atomic increment + expiry, or enforce rate limits at the edge/WAF before requests reach the app. A Redis-style counter is sufficient:

```ts
const key = `rl:${clientIp}:${Math.floor(Date.now() / 60_000)}`;
const current = await redis.incr(key);
if (current === 1) await redis.expire(key, 60);
if (current > RATE_LIMIT_PER_MIN) {
  return Response.json({ error: "Too many requests." }, { status: 429 });
}
```

Also expose remaining quota and reset metadata if you want easier monitoring and client behavior tuning.

### 3. CI/CD trusts mutable GitHub Action tags instead of immutable commit SHAs

**Severity:** Medium  
**Title:** Workflow supply chain is vulnerable to upstream action-tag compromise  
**File and line(s):** `.github/workflows/ci.yml:39-42`, `.github/workflows/ci.yml:61-64`, `.github/workflows/ci.yml:80-83`, `.github/workflows/ci.yml:110-138`, `.github/workflows/ci.yml:163-175`

**Description**  
The workflow uses actions such as `actions/checkout@v6`, `actions/setup-node@v6`, `docker/build-push-action@v6`, `docker/login-action@v3`, and `github/codeql-action/upload-sarif@v3` by mutable tags. Tags can move; commit SHAs cannot.

This is a classic CI supply-chain hardening gap. If an upstream action publisher is compromised or a tag is retargeted to malicious code, that code executes inside your workflow with repository access and, in some jobs, elevated permissions like `packages: write` and `security-events: write`.

**Exploit scenario**  
A compromised upstream action release could run arbitrary code in the `publish` job, steal the workflow token, push a malicious container to GHCR, or tamper with SARIF uploads. Because the workflow builds on every push and PR, exploitation would happen automatically once the tag resolves to the malicious revision.

**Recommendation**  
Pin every third-party action to a full commit SHA and let Dependabot/Renovate open digest-update PRs. Example:

```yaml
- uses: actions/checkout@<full-commit-sha>
- uses: actions/setup-node@<full-commit-sha>
- uses: docker/build-push-action@<full-commit-sha>
```

For higher assurance, also:

- use GitHub’s artifact attestations / provenance where applicable
- restrict `workflow_dispatch` and environment approvals for publish jobs
- consider verifying action publishers with organization allowlists

## Low Severity

### 4. Docker base images are floating tags rather than pinned digests

**Severity:** Low  
**Title:** Mutable base images weaken build reproducibility and image trust  
**File and line(s):** `Dockerfile:6`, `Dockerfile:32`

**Description**  
Both build and runtime stages use `node:20-alpine` without a digest. This means future builds can silently consume different image contents even when the Dockerfile and lockfile are unchanged.

This is primarily a supply-chain integrity issue: a compromised or unexpectedly changed upstream image could alter the build environment, inject malicious binaries, or introduce unreviewed OS packages into production.

**Exploit scenario**  
If the `node:20-alpine` tag is updated to a compromised or broken image, the next CI build will trust it automatically. That could affect `npm ci`, the generated standalone build, or the final runtime container without any repository diff.

**Recommendation**  
Pin both stages to immutable digests and rotate them deliberately:

```dockerfile
FROM node:20-alpine@sha256:<build-digest> AS build
...
FROM node:20-alpine@sha256:<runtime-digest> AS runner
```

Track digest updates with Dependabot/Renovate and rebuild on a regular cadence.

## Informational

### 5. Unused Anthropic SDK increases dependency and install-time attack surface

**Severity:** Informational  
**Title:** Remove unused `@anthropic-ai/sdk` dependency  
**File and line(s):** `package.json:13-20`

**Description**  
`@anthropic-ai/sdk` is listed as a production dependency, but I found no application import sites for it during a repository-wide search. Unused production dependencies expand the transitive dependency tree for no runtime benefit.

While `npm audit` currently reports zero known vulnerabilities, every extra package still increases supply-chain exposure, install time, lockfile churn, and the chance of future vulnerable or malicious transitive content entering local installs and CI.

**Exploit scenario**  
If the unused package or one of its transitive dependencies later ships a malicious install step or a critical vulnerability, your CI and developer machines still pull it and execute any install lifecycle behavior even though the app never needs it.

**Recommendation**  
Remove the unused dependency and refresh the lockfile:

```bash
npm uninstall @anthropic-ai/sdk
npm install
```

Then keep the production dependency list limited to packages the app actually imports at runtime.

---

## Positive Observations

- **No unsafe HTML rendering path found for LLM output.** `ResultSection.tsx` renders model-derived fields through normal React text nodes rather than `dangerouslySetInnerHTML`, which substantially lowers XSS risk.
- **Client parsing is strict enough to reject malformed model output.** `lib/validate-analysis.ts` strips common markdown/fence noise but still enforces a concrete schema and exact item counts before rendering.
- **`/api/analyze` has layered request validation.** The route checks `Content-Type`, allowed `Origin`, body size, minimum input length, and missing-field conditions before making upstream calls.
- **Stream-time error hygiene is good.** Upstream exceptions are converted to generic `__ERROR__...` messages rather than raw provider details.
- **Production response headers are strong.** The built production server on port `7010` returned CSP with a per-request nonce plus `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- **Secret hygiene is solid at the repository level.** `.gitignore` excludes `.env*`, `.dockerignore` excludes env files from build context, and `git ls-files .env.local` returned no tracked file.
- **Container least privilege is already in place.** The runtime image drops to a dedicated non-root user.
- **CI already performs useful security checks.** It runs tests, linting, type-checking, `npm audit --audit-level=high`, and Trivy image scanning.

---

## Validation Evidence

### `npm audit --audit-level=info`

```text
found 0 vulnerabilities
```

### Git tracking check for `.env.local`

Command:

```bash
git -C /home/alex/My-Projects/golden-circle ls-files .env.local
```

Output:

```text
[no output]
```

### Response headers

#### Existing listener on `http://localhost:7001/`

```http
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
X-Powered-By: Next.js
Cache-Control: s-maxage=31536000
ETag: "17kywplosneaxc"
Content-Type: text/html; charset=utf-8
Content-Length: 14168
```

This listener did **not** expose the hardened security headers visible in the production build and appears to be a separate dev/stale process rather than the reviewed production configuration.

#### Locally started production server on `http://localhost:7010/`

```http
HTTP/1.1 200 OK
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
content-security-policy: default-src 'self'; script-src 'self' 'nonce-6wiyvwix3lZgsfbsar3Zdg==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Content-Type: text/html; charset=utf-8
```

### `/api/analyze` negative tests (`http://localhost:7010/api/analyze`)

Oversized body:

```text
status 413
{"error":"Request body too large."}
```

Missing body:

```text
status 400
{"error":"Invalid JSON body."}
```

Malformed JSON:

```text
status 400
{"error":"Invalid JSON body."}
```

Missing `businessIdea` field:

```text
status 400
{"error":"businessIdea is required."}
```

Malformed-body response headers also preserved the intended hardening:

```http
HTTP/1.1 400 Bad Request
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
content-security-policy: default-src 'self'; script-src 'self' 'nonce-PxxxbW1MaCecDgWsUXaYhw==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
cache-control: no-store
content-type: application/json
```

---

## Prioritized Remediation Roadmap

1. **Fix abuse control on `/api/analyze` immediately.**  
   Move rate limiting to a shared backend or edge service, and only key it from trusted proxy identity. This is the only finding with a direct, low-cost abuse path to paid LLM usage.

2. **Pin CI actions to immutable SHAs.**  
   This is the next-highest leverage hardening step because compromise here can affect build integrity, container publication, and security reporting.

3. **Pin Docker base images to digests and rotate intentionally.**  
   This improves build reproducibility and reduces silent supply-chain drift.

4. **Prune unused production dependencies.**  
   Remove `@anthropic-ai/sdk` unless it is about to be used.

5. **Operationally ensure only the hardened production server is exposed.**  
   The process already listening on port `7001` responded with `X-Powered-By: Next.js` and lacked the reviewed production headers. Do not expose `next dev` or stale local processes on public interfaces.

