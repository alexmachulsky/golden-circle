# Security Review - 2026-04-13

## Scope

Reviewed the application code, request/response flow, deployment configuration, and runtime behavior of the Golden Circle app. The review focused on:

- `app/api/analyze/route.ts`
- `components/GoldenCircleApp.tsx`
- `components/ResultSection.tsx`
- `app/layout.tsx`
- `lib/prompt.ts`
- `lib/theme.ts`
- `next.config.ts`
- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/ci.yml`

## Executive Summary

The most important issue is that `/api/analyze` is a public, expensive endpoint with no abuse controls. A third party can drive Groq usage and server work without authentication, rate limiting, or request origin enforcement.

I did **not** find a direct XSS sink in the current result rendering path. Model output is rendered through normal React text nodes, so it is escaped by default. Dependency audit was clean at review time, the Docker image runs as a non-root user, and `.env.local` is ignored and not tracked by Git.

## Findings

| Severity | Finding | Evidence |
| --- | --- | --- |
| High | `/api/analyze` is open to quota/cost DoS | `app/api/analyze/route.ts:14-58` |
| Medium | Large request bodies are parsed before truncation | `app/api/analyze/route.ts:23-35` |
| Medium | No timeout or circuit breaker on the upstream Groq stream | `app/api/analyze/route.ts:47-74` |
| Medium | Raw backend/provider errors are exposed to clients | `app/api/analyze/route.ts:15-20`, `app/api/analyze/route.ts:68-71` |
| Medium | Missing app-level security headers and framework disclosure | `next.config.ts:1-5`, `app/layout.tsx:42` |
| Low/Medium | Prompt-injection resistance is weak and response validation is loose | `app/api/analyze/route.ts:6-12`, `lib/prompt.ts:66-74`, `components/GoldenCircleApp.tsx:67-77` |
| Low | Theme cookie lacks `Secure` | `lib/theme.ts:24` |

## Detailed Findings

### 1. High: `/api/analyze` is open to quota/cost DoS

**Evidence**

- The route accepts unauthenticated requests and has no rate limit, origin check, or host validation in `app/api/analyze/route.ts:14-58`.
- The handler only checks that `businessIdea` exists and is a string before making an upstream Groq request.
- At runtime, the route also accepted JSON sent with `Content-Type: text/plain;charset=UTF-8`, which means a third-party site can submit a browser "simple request" without a CORS preflight.

**Impact**

- Anyone who can reach the app can spend Groq quota.
- A malicious site can cause visitors' browsers to generate requests to the endpoint.
- Multiple slow concurrent requests can consume server capacity and upstream model capacity.

**Recommended fix**

1. Add rate limiting for `/api/analyze`.
2. Enforce `Content-Type: application/json` and reject other types.
3. Validate `Origin` and `Host` for browser requests.
4. Consider lightweight authentication if the endpoint is not intended to be fully public.

### 2. Medium: Large request bodies are parsed before truncation

**Evidence**

- `await req.json()` happens before `sanitizeInput(...).slice(0, 2000)` in `app/api/analyze/route.ts:23-35`.

**Impact**

- If an upstream proxy or platform body limit is absent or permissive, the app still has to parse the full incoming body before reducing it to 2000 characters.
- This creates unnecessary memory and CPU exposure on a route that is already easy to abuse.

**Recommended fix**

1. Enforce a strict request body size limit at the platform or proxy layer.
2. Reject oversized requests before JSON parsing where possible.
3. Keep the application-level length check, but do not rely on post-parse truncation as the primary defense.

### 3. Medium: No timeout or circuit breaker on the upstream Groq stream

**Evidence**

- The ReadableStream in `app/api/analyze/route.ts:47-74` waits for the upstream Groq stream to finish and does not use an `AbortController` or timeout.

**Impact**

- Slow or stuck upstream calls can leave requests open for too long.
- This increases the blast radius of abuse and raises the risk of request pileups during provider degradation.

**Recommended fix**

1. Wrap the upstream call in an `AbortController`.
2. Set a hard timeout for the full request lifecycle.
3. Consider adding concurrency limits if this route is exposed publicly.

### 4. Medium: Raw backend/provider errors are exposed to clients

**Evidence**

- Missing-secret details are returned directly in `app/api/analyze/route.ts:15-20`.
- Upstream errors are forwarded with `__ERROR__${message}` in `app/api/analyze/route.ts:68-71`.

**Impact**

- This reveals backend configuration and provider behavior to clients.
- It makes external probing easier and leaks details that are more useful server-side than user-side.

**Recommended fix**

1. Return generic client-facing errors.
2. Log detailed provider errors on the server only.
3. Apply `Cache-Control: no-store` consistently to error responses as well as streamed success responses.

### 5. Medium: Missing app-level security headers and framework disclosure

**Evidence**

- `next.config.ts:1-5` only enables standalone output and defines no security headers.
- Runtime responses exposed `X-Powered-By: Next.js`.
- No CSP, frame protection, or referrer policy was present on the app response during local runtime checks.
- `app/layout.tsx:42` injects an inline theme bootstrapping script, which means CSP must be designed intentionally instead of added later as an afterthought.

**Impact**

- Clickjacking protection is absent unless external infrastructure adds it.
- Future injection bugs would have a larger blast radius without CSP.
- `X-Powered-By` unnecessarily discloses framework information.

**Recommended fix**

1. Add a security header policy with:
   - `Content-Security-Policy`
   - `X-Frame-Options: DENY` or `frame-ancestors 'none'`
   - `Referrer-Policy`
   - `X-Content-Type-Options: nosniff`
2. Disable `X-Powered-By`.
3. Add HSTS at the TLS terminator in production.
4. Use a nonce or hash strategy for the inline theme script if CSP is introduced.

### 6. Low/Medium: Prompt-injection resistance is weak and response validation is loose

**Evidence**

- `sanitizeInput()` in `app/api/analyze/route.ts:6-12` only strips HTML/XML-like tags.
- `buildUserPrompt()` in `lib/prompt.ts:66-74` embeds raw user text directly into the prompt payload.
- The client only performs basic shape checks before trusting parsed model output in `components/GoldenCircleApp.tsx:67-77`.

**Impact**

- Attackers can more easily coerce malformed or adversarial model output.
- The current cleanup/parsing approach is resilient to formatting mistakes, but it is not a strong contract-enforcement layer.
- This is mainly an integrity and availability risk, not a proven code-execution issue in the current UI.

**Recommended fix**

1. Add strict schema validation for the model response.
2. Reject responses that do not exactly match the expected structure.
3. Treat prompt-injection mitigation as output validation and policy enforcement, not HTML stripping.

### 7. Low: Theme cookie lacks `Secure`

**Evidence**

- `document.cookie = ... SameSite=Lax` is set in `lib/theme.ts:24`, but `Secure` is omitted.

**Impact**

- The cookie is not sensitive, so the direct risk is low.
- It is still better practice to keep even non-sensitive cookies off plaintext transport.

**Recommended fix**

Add `Secure` when the app is served over HTTPS.

## Positive Observations

- `ResultSection.tsx` renders model output as normal React text, not via `dangerouslySetInnerHTML`.
- `npm audit` returned no known vulnerabilities at review time.
- The Docker runtime image uses a non-root user.
- `.env.local` is ignored by Git and is **not tracked** in the repository.
- CI already includes `npm audit` and a Trivy image scan.

## Operational Note

This workspace contains a local `.env.local` with a `GROQ_API_KEY`. The file is ignored and not tracked by Git, so this is **not** a source-control leak based on the current repository state. Because this environment may be shared, the key should still be rotated if it is active and not already scoped or disposable.

## Recommended Priority Order

1. Add abuse controls to `/api/analyze`: rate limit, content-type enforcement, origin/host validation, and a request timeout.
2. Stop returning raw provider/configuration errors to clients.
3. Add app-level security headers and remove framework disclosure.
4. Tighten model response validation instead of relying on loose parsing cleanup.
