# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch the deployment and abuse-control gaps found in the 2026-04-27 security review.

**Architecture:** Keep the app fail-closed for public production while preserving an explicit local-only development path. Public deployments must have a trusted proxy identity header, shared rate limiting, and Turnstile configured before `/api/analyze` serves paid LLM traffic.

**Tech Stack:** Next.js 16.2.4 App Router, TypeScript, Vitest, Docker Compose, nginx, Kubernetes manifests, npm audit.

---

## File Structure

- Modify `docker-compose.yml`: make the default compose topology match README by adding nginx in front of the app, publishing only loopback, and removing public local-mode exposure.
- Create `docker-compose.local.yml`: keep single-container local production testing explicit and loopback-only.
- Modify `nginx.conf`: keep header stripping and add any missing proxy headers needed by Next.
- Modify `README.md`: document local compose vs public compose behavior.
- Modify `lib/turnstile.ts`: require Turnstile in public production.
- Modify `app/api/health/route.ts`: mark missing public-production Turnstile as unable to serve.
- Modify `app/api/analyze/route.test.ts`: add failing/passing tests for public production without Turnstile.
- Modify `app/api/health/route.test.ts`: update health expectations for missing Turnstile.
- Modify `k8s/configmap.yaml`: use a dedicated sanitized client-IP header.
- Create `k8s/ingress.yaml` or document an existing ingress controller config: set and strip the trusted client-IP header.
- Modify `package.json` and `package-lock.json`: patch PostCSS via package upgrades or an npm override.
- Modify `.github/workflows/ci.yml`: add a moderate audit review step if the dependency fix cannot land immediately.
- Optionally modify `components/*` and `lib/security-headers.ts`: remove production `style-src-attr 'unsafe-inline'` after moving inline styles to CSS variables/classes.

## Task 1: Docker Compose Public Exposure

**Files:**
- Modify: `docker-compose.yml`
- Create: `docker-compose.local.yml`
- Modify: `README.md`

- [ ] **Step 1: Write the failing configuration check**

Create `docs/security-checks/compose-security-check.md` with the exact expected compose posture:

```markdown
# Compose Security Check

Default `docker-compose.yml` must:

- publish only nginx on `127.0.0.1:7001`
- not publish the app container directly
- set `TRUSTED_IP_HEADER=x-real-ip`
- not set `DEPLOYMENT_MODE=local`

`docker-compose.local.yml` may set `DEPLOYMENT_MODE=local`, but must publish only `127.0.0.1:7001`.
```

- [ ] **Step 2: Verify the current config fails the check**

Run:

```bash
docker compose config
```

Expected before patch: output shows `0.0.0.0:7001:7001` or direct app port publishing with `DEPLOYMENT_MODE: local`.

- [ ] **Step 3: Patch default compose**

Change `docker-compose.yml` to:

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    depends_on:
      - app
    ports:
      - "127.0.0.1:7001:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runner
    image: golden-circle:latest
    restart: unless-stopped
    expose:
      - "7001"
    read_only: true
    tmpfs:
      - /tmp:size=64M,noexec,nosuid
    environment:
      NODE_ENV: production
      ALLOWED_ORIGINS: "http://localhost:7001"
      TRUSTED_IP_HEADER: x-real-ip
      GROQ_API_KEY_FILE: /run/secrets/groq_api_key
      UPSTASH_REDIS_REST_TOKEN_FILE: /run/secrets/upstash_redis_rest_token
      TURNSTILE_SECRET_KEY_FILE: /run/secrets/turnstile_secret_key
    env_file:
      - .env.compose
    secrets:
      - groq_api_key
      - upstash_redis_rest_token
      - turnstile_secret_key
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

Keep existing resource limits and healthcheck from the current file.

- [ ] **Step 4: Add explicit local override**

Create `docker-compose.local.yml`:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:7001:7001"
    environment:
      DEPLOYMENT_MODE: local
      ALLOWED_ORIGINS: "http://localhost:7001"
```

- [ ] **Step 5: Verify compose posture**

Run:

```bash
docker compose config
docker compose -f docker-compose.yml -f docker-compose.local.yml config
```

Expected:

- default config has no direct app port publish and no `DEPLOYMENT_MODE: local`
- local override binds only `127.0.0.1:7001`

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker-compose.local.yml README.md docs/security-checks/compose-security-check.md
git commit -m "fix: harden compose exposure defaults"
```

## Task 2: Turnstile Fail-Closed in Public Production

**Files:**
- Modify: `lib/turnstile.ts`
- Modify: `app/api/health/route.ts`
- Modify: `app/api/analyze/route.test.ts`
- Modify: `app/api/health/route.test.ts`

- [ ] **Step 1: Add failing analyze-route test**

Add to `app/api/analyze/route.test.ts`:

```ts
it("returns 503 in public production when Turnstile is not configured", async () => {
  setNodeEnv("production");
  setDeploymentMode(undefined);
  process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
  process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;

  const fetchMock = mockProductionFetch();
  const res = await POST(makeReq({ headers: { "x-client-ip": "203.0.113.10" } }));

  expect(res.status).toBe(503);
  await expect(res.json()).resolves.toEqual({ error: "Service unavailable." });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run app/api/analyze/route.test.ts
```

Expected: the new test fails because `verifyTurnstileToken()` currently returns successfully when both keys are missing.

- [ ] **Step 3: Implement public-production requirement**

In `lib/turnstile.ts`, add:

```ts
function isPublicProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" && env.DEPLOYMENT_MODE?.trim().toLowerCase() !== "local";
}
```

Then change the missing-config branch:

```ts
if (!config) {
  if (isPublicProduction(env)) {
    throw new TurnstileError(503, "Service unavailable.", "Turnstile is required in public production.");
  }
  return;
}
```

- [ ] **Step 4: Update health behavior**

In `app/api/health/route.ts`, compute public production:

```ts
const isPublicProduction =
  process.env.NODE_ENV === "production" &&
  process.env.DEPLOYMENT_MODE?.trim().toLowerCase() !== "local";
```

Then make missing Turnstile fail the serviceability check:

```ts
const turnstileRequired = isPublicProduction;
const canServeRequests =
  groqConfigured &&
  turnstileConfigured &&
  (!turnstileRequired || turnstileEnabled);
```

- [ ] **Step 5: Update health tests**

Change `app/api/health/route.test.ts` so public production with only Groq returns 503:

```ts
it("returns 503 in public production when Turnstile is disabled", async () => {
  setNodeEnv("production");
  process.env.GROQ_API_KEY = "groq-key";

  const res = await GET();

  expect(res.status).toBe(503);
  await expect(res.json()).resolves.toEqual({ status: "degraded" });
});
```

Add a local-mode test:

```ts
it("allows local production health with Turnstile disabled", async () => {
  setNodeEnv("production");
  process.env.DEPLOYMENT_MODE = "local";
  process.env.GROQ_API_KEY = "groq-key";

  const res = await GET();

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ status: "degraded" });
});
```

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run app/api/analyze/route.test.ts app/api/health/route.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/turnstile.ts app/api/health/route.ts app/api/analyze/route.test.ts app/api/health/route.test.ts
git commit -m "fix: require turnstile in public production"
```

## Task 3: Kubernetes Trusted Client IP Header

**Files:**
- Modify: `k8s/configmap.yaml`
- Create: `k8s/ingress.yaml`
- Modify: `README.md`

- [ ] **Step 1: Document desired header contract**

Add to `README.md` Kubernetes section:

```markdown
The app must never trust a client-supplied forwarding header directly. The ingress layer must strip inbound copies and set `x-client-ip` from the actual remote address before proxying to the app. `TRUSTED_IP_HEADER` must match that sanitized header.
```

- [ ] **Step 2: Update app config**

Change `k8s/configmap.yaml`:

```yaml
TRUSTED_IP_HEADER: "x-client-ip"
```

- [ ] **Step 3: Add ingress manifest**

Create `k8s/ingress.yaml` for nginx ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: golden-circle
  namespace: golden-circle
  annotations:
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header X-Client-IP $remote_addr;
      proxy_set_header X-Forwarded-For $remote_addr;
spec:
  ingressClassName: nginx
  rules:
    - host: golden-circle.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: golden-circle
                port:
                  number: 80
```

For EKS ALB instead of nginx, replace this manifest with an ALB-specific documented equivalent before applying.

- [ ] **Step 4: Verify manifest syntax**

Run:

```bash
kubectl apply --dry-run=client -f k8s/
```

Expected: all manifests are accepted by client-side validation.

- [ ] **Step 5: Commit**

```bash
git add k8s/configmap.yaml k8s/ingress.yaml README.md
git commit -m "fix: use sanitized client ip header in k8s"
```

## Task 4: Compose Secret Precedence

**Files:**
- Modify: `lib/runtime-env.ts`
- Modify: relevant tests, likely `app/api/analyze/route.test.ts`, `app/api/health/route.test.ts`, and `lib/rate-limit.test.ts`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add failing precedence test**

Add a runtime-env test file `lib/runtime-env.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeValue } from "./runtime-env";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

it("prefers file-backed secrets in production when both direct and file values exist", () => {
  tempDir = mkdtempSync(join(tmpdir(), "golden-circle-runtime-env-"));
  const filePath = join(tempDir, "secret.txt");
  writeFileSync(filePath, "file-secret", "utf8");

  const value = readRuntimeValue("GROQ_API_KEY", {
    NODE_ENV: "production",
    VITEST: "1",
    GROQ_API_KEY: "direct-secret",
    GROQ_API_KEY_FILE: filePath,
  });

  expect(value).toBe("file-secret");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run lib/runtime-env.test.ts
```

Expected: test fails because direct env currently wins.

- [ ] **Step 3: Implement secret file precedence**

In `lib/runtime-env.ts`, for production only, read a non-empty `NAME_FILE` first, then direct env. Preserve direct-env precedence for non-production.

Use this structure:

```ts
const filePath = env[`${name}_FILE`]?.trim()
const preferFile = env.NODE_ENV === "production" && Boolean(filePath)

if (preferFile) {
  const fileValue = readRuntimeFile(name, filePath, env)
  if (fileValue) return fileValue
}

const directValue = env[name]?.trim()
if (directValue) return directValue

if (filePath) {
  const fileValue = readRuntimeFile(name, filePath, env)
  if (fileValue) return fileValue
}
```

Extract the existing safe-directory and file-read logic into `readRuntimeFile()`.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run lib/runtime-env.test.ts app/api/analyze/route.test.ts app/api/health/route.test.ts lib/rate-limit.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-env.ts lib/runtime-env.test.ts app/api/analyze/route.test.ts app/api/health/route.test.ts lib/rate-limit.test.ts docker-compose.yml
git commit -m "fix: prefer mounted secrets in production"
```

## Task 5: PostCSS Advisory

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml` if needed

- [ ] **Step 1: Verify current advisory**

Run:

```bash
npm audit --audit-level=moderate --omit=dev
npm ls postcss next --all
```

Expected before patch: audit reports `postcss <8.5.10`.

- [ ] **Step 2: Try safe dependency update first**

Run:

```bash
npm update @tailwindcss/postcss @vitejs/plugin-react vite next eslint-config-next
```

Then run:

```bash
npm ls postcss next --all
npm audit --audit-level=moderate --omit=dev
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: either advisory clears, or remaining vulnerable PostCSS is only nested under `next`.

- [ ] **Step 3: If advisory remains, test npm override**

Add to `package.json`:

```json
"overrides": {
  "postcss": "8.5.10"
}
```

Run:

```bash
npm install
npm ls postcss next --all
npm audit --audit-level=moderate --omit=dev
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: PostCSS resolves to `8.5.10` or newer and the app still builds.

- [ ] **Step 4: If override breaks Next, document temporary risk**

If build fails only because Next does not tolerate the override, add a CI comment and a tracking issue. Do not downgrade Next.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .github/workflows/ci.yml
git commit -m "fix: patch postcss advisory"
```

## Task 6: CSP Style Attribute Hardening

**Files:**
- Modify: `components/GoldenCircle.tsx`
- Modify: `components/LoadingState.tsx`
- Modify: `components/GoldenCircleApp.tsx`
- Modify: `components/ThemeToggle.tsx`
- Modify: `app/globals.css`
- Modify: `lib/security-headers.ts`
- Modify: `lib/security-headers.test.ts`

- [ ] **Step 1: Add failing CSP test**

Update `lib/security-headers.test.ts`:

```ts
it("does not allow inline style attributes in production", () => {
  const csp = buildContentSecurityPolicy({ NODE_ENV: "production" }, "abc123");

  expect(csp).not.toContain("style-src-attr 'unsafe-inline'");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run lib/security-headers.test.ts
```

Expected: test fails while production CSP still includes `style-src-attr 'unsafe-inline'`.

- [ ] **Step 3: Replace inline style props**

For static theme styles, move values into CSS classes or existing CSS variables in `app/globals.css`.

For dynamic SVG transform origins, use CSS custom properties and typed style only where browser support requires it. If React inline style remains necessary for SVG transform origin, document the exception and keep this finding accepted.

- [ ] **Step 4: Remove production style-src-attr unsafe-inline**

Change `lib/security-headers.ts` so `style-src-attr 'unsafe-inline'` is emitted only when `NODE_ENV === "development"`.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run lib/security-headers.test.ts components/__tests__/InputForm.smoke.test.tsx components/__tests__/TurnstileWidget.test.tsx
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add components app/globals.css lib/security-headers.ts lib/security-headers.test.ts
git commit -m "fix: tighten production style csp"
```

## Final Verification

Run after all tasks:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --audit-level=moderate --omit=dev
docker compose config
docker compose -f docker-compose.yml -f docker-compose.local.yml config
```

Expected:

- Vitest passes.
- ESLint passes.
- TypeScript passes.
- Production build succeeds.
- npm audit has no unaccepted moderate/high/critical production advisories.
- Default compose does not publish the app directly and does not set local mode.
- Local compose override binds only to loopback.

## Self-Review

- Spec coverage: Covers all findings from `docs/security-review-2026-04-27.md`.
- Marker scan: No deferred-work markers are present.
- Type consistency: New helper names and env names are consistent across tasks.

Plan complete and saved to `docs/superpowers/plans/2026-04-27-security-hardening.md`.
