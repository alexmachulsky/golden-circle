# Security Review - 2026-04-19

## Executive Summary

This audit focused on the Next.js app, API abuse controls, deployment manifests, and supply-chain hygiene. The codebase is generally disciplined: React rendering avoids obvious XSS sinks, `.env.local` is not tracked, `npm audit` returned zero known package advisories, tests passed, lint passed, type-check passed, and the production build succeeded.

The main risk is not classic injection. It is abuse-control and deployment drift. The strongest finding is that production rate limiting can still collapse into a single global bucket when `TRUSTED_IP_HEADER` is unset, which lets one client deny service to everyone. The checked-in Compose deployment also promotes a secret into the container environment and publishes the app directly over plaintext HTTP on all interfaces.

## High Severity

### SEC-001 - Production rate limiting can collapse into one global bucket

- Rule ID: SEC-001
- Severity: High
- Location: `lib/rate-limit.ts:232-250`, `lib/config.ts:29-40`, `lib/rate-limit.test.ts:202`
- Evidence:

```ts
export function getClientKey(req: Request, trustedIpHeader: string | null = null): string {
  const trustedValue = normalizeClientKey(
    trustedIpHeader ? req.headers.get(trustedIpHeader) : null,
  );

  if (trustedValue) {
    return trustedValue;
  }

  if (isProduction() && trustedIpHeader) {
    throw new RateLimitError(
      `Missing trusted client identity header: ${trustedIpHeader}.`,
    );
  }

  return LOCAL_KEY;
}
```

The production test suite currently codifies this fallback.

- Impact: if `TRUSTED_IP_HEADER` is unset in production, all callers share the same limiter key. One client can burn the entire request budget and force `429` for every user. Turnstile also loses per-client `remoteip` binding because the route treats `__local__` as local mode.
- Fix: in production, fail closed when `TRUSTED_IP_HEADER` is unset, missing, or invalid. Do not return `LOCAL_KEY` in production.
- Mitigation: surface this as unhealthy in `/api/health` and block startup in production deployments that omit the trusted header.
- False positive notes: none. This behavior is directly visible in code and tests.

### SEC-002 - Docker Compose promotes the Groq key into the container environment

- Rule ID: SEC-002
- Severity: High
- Location: `docker-compose.yml:35-39`, `.env.local.example:1-4`
- Evidence:

```yaml
env_file:
  - .env.local
```

```env
GROQ_API_KEY=your_api_key_here
```

I also rendered the live Compose config safely and confirmed both `GROQ_API_KEY` and `GROQ_API_KEY_FILE` are present at runtime.

- Impact: the key becomes readable through `docker inspect`, process environments, crash dumps, and some control-plane UIs. That defeats the intended "secret file only" posture.
- Fix: stop using `.env.local` as a production `env_file`. Split non-secret settings into a separate file such as `.env.runtime`, and load `GROQ_API_KEY` only from `GROQ_API_KEY_FILE` or an external secret manager.
- Mitigation: rotate the current Groq key if this Compose deployment has been used outside local-only testing.
- False positive notes: this depends on using the checked-in Compose path. The repo state itself does not show the key committed to Git.

### SEC-003 - The checked-in Compose deployment publishes plaintext HTTP on all interfaces

- Rule ID: SEC-003
- Severity: High
- Location: `docker-compose.yml:10-11`, `docker-compose.yml:23-25`
- Evidence:

```yaml
ports:
  - "7001:7001"
environment:
  NODE_ENV: production
  ALLOWED_ORIGINS: "http://localhost:7001,http://192.168.18.241:7001"
```

- Impact: if this Compose file is used as an internet-facing deployment, requests and responses are exposed over plaintext HTTP, and the Next.js server is reachable directly without the intended proxy/TLS layer.
- Fix: bind the app only to loopback or an internal Docker network, then front it with a TLS-terminating reverse proxy or load balancer. If Compose is strictly local-only, document that explicitly and remove the misleading production settings.
- Mitigation: do not expose port `7001` publicly; restrict it with a host firewall until a proxy is in place.
- False positive notes: if this file is never used outside localhost, the risk is operational rather than a production vulnerability.

## Medium Severity

### SEC-004 - Turnstile is optional in production and not bound to expected hostname or action

- Rule ID: SEC-004
- Severity: Medium
- Location: `lib/turnstile.ts:35-57`, `lib/turnstile.ts:93-101`, `app/api/health/route.ts:29-40`
- Evidence:

```ts
if (!siteKey && !secretKey) {
  return null
}
```

```ts
if (!config) {
  return
}
```

```ts
if (!payload.success) {
  throw new TurnstileError(403, "Verification failed.", "Turnstile rejected the submitted token.")
}
```

- Impact: production can run with no bot challenge at all, and when Turnstile is enabled the server only checks `success`, not `hostname`, `action`, or returned error codes. That weakens replay resistance and abuse visibility.
- Fix: require Turnstile for anonymous production access, validate `hostname` and `action`, and reject tokens that do not match the expected site/action.
- Mitigation: if public anonymous access must remain, compensate with stronger quotas and real authentication for privileged usage tiers.
- False positive notes: if the app is intentionally public and rate-limited, this is a hardening issue rather than a strict access-control bypass.

### SEC-005 - Client identity normalization accepts malformed and unstable values

- Rule ID: SEC-005
- Severity: Medium
- Location: `lib/rate-limit.ts:66-80`
- Evidence:

```ts
const VALID_IP_RE =
  /^(?:\[[\da-fA-F:]+\]|[\da-fA-F:]+|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?$/;
```

Local verification showed this regex accepts values such as `deadbeef`, `203.0.113.10:49152`, and `999.999.999.999`.

- Impact: if operators point `TRUSTED_IP_HEADER` at `X-Forwarded-For` or another non-normalized header, the limiter can key on the wrong value or on changing source ports. That weakens quotas and can poison the `remoteip` sent to Turnstile.
- Fix: trust a dedicated single-IP header from the final proxy, strip ports/brackets, and validate with `net.isIP()`. Do not use a generic regex for IP identity.
- Mitigation: document a single required proxy header contract, e.g. `X-Client-IP`, and have the proxy strip inbound copies before setting it.
- False positive notes: if the deployment always injects a clean single-IP header, the exposure is reduced. The parser still accepts malformed values today.

### SEC-006 - CI only audits production dependencies even though dev dependencies execute in CI

- Rule ID: SEC-006
- Severity: Medium
- Location: `.github/workflows/ci.yml:67-80`
- Evidence:

```yaml
- name: Run tests
  run: npm test
- name: Lint
  run: npm run lint
- name: Type-check
  run: npx tsc --noEmit
- name: Dependency audit
  run: npm audit --audit-level=high --omit=dev
```

- Impact: a compromised or vulnerable dev dependency can still run during test, lint, or type-check jobs, but the audit gate will never flag it.
- Fix: keep the production-only audit if you want it, but add a second full-tree audit for CI tooling, e.g. `npm audit --include=dev --audit-level=high`.
- Mitigation: pin the package manager and Node version for reproducibility and faster incident response.
- False positive notes: the local `npm audit --json` run was clean today. This finding is about coverage of the control, not a currently known vulnerable package.

## Low Severity

### SEC-007 - Model output can retain bidi and invisible control characters in the UI

- Rule ID: SEC-007
- Severity: Low
- Location: `lib/validate-analysis.ts:87-92`, `components/ResultSection.tsx:176`, `components/ResultSection.tsx:249`, `components/ResultSection.tsx:255`
- Evidence:

`parseAnalysis()` enforces type and length, but it does not normalize bidi and invisible control characters before UI rendering. The clipboard export path already strips them.

- Impact: a malicious or prompt-injected model response can visually reorder or hide text in the rendered result or print view even though HTML injection is blocked.
- Fix: normalize model strings once during parsing or before storing them in client state, reusing the same control-character stripping used for clipboard export.
- Mitigation: keep React text rendering; do not introduce raw HTML sinks.
- False positive notes: this is a presentation-integrity issue, not script execution.

### SEC-008 - Blanket Trivy ignores weaken future scan confidence

- Rule ID: SEC-008
- Severity: Low
- Location: `.github/workflows/ci.yml:107-135`, `.trivyignore:1-22`
- Evidence:

The workflow uses `.trivyignore` for both SARIF upload and the failing gate, and the ignore file suppresses raw CVE IDs without expiry metadata.

- Impact: future matches for the same CVE IDs can be hidden from both the GitHub Security tab and the blocking scan.
- Fix: convert ignore entries into time-bounded exceptions with owner, rationale, upstream tracking link, and expiration date. Remove them as soon as upstream fixes land.
- Mitigation: review `.trivyignore` on every Next.js and base-image update.
- False positive notes: current local audit results were clean; this is a scanner-governance issue.

## Checks Run

- `npm audit --json` -> 0 vulnerabilities
- `npm test` -> 56 tests passed
- `npm run lint` -> passed
- `npx tsc --noEmit` -> passed
- `npm run build` -> passed
- `git ls-files .env.local` -> not tracked

## Recommended Patch Order

1. Fix `SEC-001` first. Fail closed in production when trusted client identity is missing.
2. Fix `SEC-002` and `SEC-003` together by separating secret and non-secret runtime config and putting a proxy/TLS layer in front of the app.
3. Fix `SEC-004` and `SEC-005` by tightening Turnstile validation and trusted IP parsing.
4. Fix `SEC-006` and `SEC-008` to improve supply-chain detection.
5. Fix `SEC-007` as a low-risk integrity hardening improvement.
