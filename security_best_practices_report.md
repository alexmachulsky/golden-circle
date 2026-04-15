# Security Best Practices Report

Date: 2026-04-15

## Executive Summary

The current working tree has already closed most of the earlier direct application vulnerabilities around `/api/analyze`: production now requires shared rate limiting, a trusted client-identity header, server-verified Turnstile checks, runtime secret-file support, CSP, and generic error handling.

I found one remaining high-severity architectural risk and one remaining medium-severity deployment trust assumption. I also patched two repo-grounded hardening issues in this pass: mutable GHCR `:latest` publishing and missing container privilege restrictions in `docker-compose.yml`.

## Live Findings

### GC-SEC-001

- Rule ID: GC-SEC-001
- Severity: High
- Location: `app/api/analyze/route.ts:60-66`, `app/api/analyze/route.ts:122-151`, `lib/rate-limit.ts:173-189`, `lib/turnstile.ts:47-105`
- Evidence:

```ts
clientKey = getClientKey(req, TRUSTED_IP_HEADER);
const allowed = await checkRateLimit(clientKey, {
  limit: RATE_LIMIT_PER_MIN,
  windowMs: 60_000,
});
```

```ts
await verifyTurnstileToken({
  token: rawBody.turnstileToken,
  remoteIp: clientKey === "__local__" ? null : clientKey,
});
```

```ts
model: MODEL,
max_tokens: 1024,
stream: true,
```

- Impact: the endpoint is no longer trivially abuseable from a single browser or a single spoofed IP, but it is still a public paid inference path. A distributed attacker with valid Turnstile solves can continue to burn Groq quota because there is no authenticated user identity, per-user budget, or per-account daily cap enforced before the upstream model call.
- Fix: add a server-side identity or ticketing layer in front of Groq. The clean options are authenticated users with quotas, or signed short-lived analysis tickets minted by your own backend and redeemed once.
- Mitigation: keep provider spend caps/alerts enabled, reduce `max_tokens` to the smallest value that still satisfies the response schema, and keep the existing Upstash + Turnstile controls in place.
- False positive notes: if this service is intentionally public and low-volume, this is primarily a spend-abuse and availability finding rather than an authorization bug.

### GC-SEC-002

- Rule ID: GC-SEC-002
- Severity: Medium
- Location: `lib/rate-limit.ts:193-220`, `lib/config.ts:16-27`, `docker-compose.yml:10-32`
- Evidence:

```ts
const trustedValue = normalizeClientKey(
  trustedIpHeader ? req.headers.get(trustedIpHeader) : null,
);
```

```ts
export const TRUSTED_IP_HEADER: string | null = process.env.TRUSTED_IP_HEADER ?? null;
```

- Impact: the rate limiter and Turnstile `remoteip` binding trust whatever arrives in `TRUSTED_IP_HEADER`. If a deployment exposes the app directly or a reverse proxy fails to strip inbound copies of that header, an attacker can choose arbitrary client identities and weaken the per-IP abuse controls.
- Fix: keep the app reachable only through infrastructure that rewrites this header authoritatively, and document the requirement as a hard deployment invariant.
- Mitigation: the compose profile now binds only to `127.0.0.1` by default, which reduces accidental direct exposure; keep firewall and proxy ACLs aligned with that assumption.
- False positive notes: when the app is only reachable behind a correctly configured reverse proxy, this becomes a deployment hygiene issue rather than an exploitable app bug.

## Patched In This Pass

### GC-SEC-003

- Rule ID: GC-SEC-003
- Severity: Medium
- Location: `.github/workflows/ci.yml:175-183`, `README.md:94-106`
- Summary: GHCR publishing and deployment guidance previously allowed mutable `:latest` consumption, which weakened provenance and reproducibility.
- Patch: removed `:latest` from the publish workflow and updated the docs to recommend immutable commit-SHA pulls.

### GC-SEC-004

- Rule ID: GC-SEC-004
- Severity: Low
- Location: `docker-compose.yml:25-32`
- Summary: the compose runtime already used a non-root user, but it still kept default Linux capabilities and allowed privilege escalation.
- Patch: added `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]`.

## Strong Controls Already Present

- No concrete client-side XSS path was found. Model output is rendered through normal React text nodes, and the only `dangerouslySetInnerHTML` usage is constant-only and nonce-protected.
- `npm audit --audit-level=high` reported `found 0 vulnerabilities`.
- Production requests fail closed when Upstash rate limiting, trusted client identity, or Turnstile configuration is missing.
- Runtime secrets can be loaded from mounted files via `*_FILE` variables instead of plaintext env injection.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `docker compose config`
