# Security Review Follow-up - 2026-04-27

## Scope

Hand-off note recording the state of the audit findings from the three prior
reviews (`docs/security-review-2026-04-13.md`, `…04-19-codex.md`, `…04-26.md`)
plus the new findings from `…04-27.md`, after a P0/P1/P2 patch pass executed
in this session alongside an in-flight hardening workflow at
`docs/superpowers/plans/2026-04-27-security-hardening.md`.

## Patches landed this pass

### P0 — High-severity rate-limit identity

- `lib/rate-limit.ts`: replaced `VALID_IP_RE` with `net.isIP()` validation.
  Strips IPv6 brackets and IPv4 `:port` suffixes; rejects out-of-range
  octets, hex garbage, malformed colon strings, and hostnames. Closes
  SEC-005 (codex 04-19).
- `lib/rate-limit.test.ts`: added 8 cases for the previously-broken inputs
  (`999.999.999.999`, `deadbeef`, `:::::::::`, `1.2.3.4:5555`,
  `[2001:db8::1]:443`, `::1`, `evil.example.com`).
- `k8s/configmap.yaml`: `TRUSTED_IP_HEADER` switched from `x-forwarded-for`
  (rightmost token is the ingress hop and would collapse all traffic into
  one bucket) to `x-real-ip` (single-value, ingress-nginx-set). Closes
  SEC-N1.
- `package-lock.json`: synced to the parallel agent's `postcss` override
  in `package.json` so the docker rebuild can run.

### P1 — Medium severity

- `lib/turnstile-action.ts` (new), `lib/turnstile.ts`,
  `components/TurnstileWidget.tsx`, `app/api/analyze/route.test.ts`:
  Turnstile tokens are now tagged with `action="analyze"` and validated
  on the server against the expected action plus the configured site
  hostname (derived from `ALLOWED_ORIGINS`). `error-codes` from siteverify
  are logged server-side. Closes SEC-004.
- `.trivyignore`: every suppressed CVE now carries `expires=`, `owner=`,
  `upstream=` metadata. Default expiry is `2026-10-27` (six months) or
  the next Next.js minor release, whichever comes first. Closes SEC-008.

### P2 — Low severity

- `lib/validate-analysis.ts`, `lib/validate-analysis.test.ts`: bidi /
  zero-width / control characters are stripped during `parseAnalysis()`
  so all consumers (UI render, copy, print) see normalized text. Closes
  SEC-007.
- `app/api/health/route.ts`, `app/api/health/route.test.ts`: when
  `DEPLOYMENT_MODE=local` the route no longer flags missing Upstash or
  `TRUSTED_IP_HEADER` as degraded — those are public-production-only
  requirements. Verified live: the local container now reports
  `{"status":"ok"}` instead of `degraded`. Closes SEC-N3.
- `app/api/analyze/route.ts:208`: flush sentinel check uses
  `includes("__ERROR__")` to match the buffered branch's regex. Closes
  SEC-N4.
- `k8s/configmap.yaml`: placeholder strings for `TURNSTILE_SITE_KEY` and
  `UPSTASH_REDIS_REST_URL` are commented out so applying the manifests
  as-is no longer fail-closes every analyze. Closes SEC-N5.
- `app/layout.tsx`: targeted `eslint-disable-next-line` for the
  `@next/next/no-sync-scripts` violation on the intentional plain
  `<script src="/theme-init.js">` (preserves the parallel agent's choice
  to avoid the next/script CSP-nonce hydration mismatch under Turbopack).

## Patches landed by the parallel hardening workflow

These were already in the working tree when this pass started and were
left untouched:

- `docker-compose.yml`: refactored to nginx-fronted topology — nginx
  publishes `127.0.0.1:7001`, app on internal `expose:` only. Closes
  SEC-003.
- `docker-compose.local.yml` (new): loopback-only single-container path
  that still uses `.env.local` for the local Groq key.
- `lib/turnstile.ts`: requires Turnstile in public production
  (`DEPLOYMENT_MODE != "local"`) and 503s when missing. Partial closure
  of SEC-004 (the rest landed this pass).
- `app/api/health/route.ts`: marks missing public-production Turnstile
  as unable to serve.
- `lib/security-headers.ts`, `app/layout.tsx`, `proxy.ts`,
  `next.config.ts`: CSP nonce wiring tightening.

## Findings still open

### Open by user instruction

| ID | Severity | Note |
|---|---|---|
| SEC-002 (codex 04-19) | High | `docker-compose.yml` no longer loads `.env.local`, but `docker-compose.local.yml` still does. The Groq key is gitignored, so residual risk is local-host only. User opted to keep this arrangement. |
| SEC-N2 (this review) | Medium | `k8s/deployment.yaml` injects secrets via `secretKeyRef` → env vars rather than `*_FILE` mounts. Pod env still leaks via `kubectl describe pod`. Same rationale as SEC-002. |

### Open and tracked by the parallel hardening plan

| ID | Severity | Note |
|---|---|---|
| SEC-006 (codex 04-19) | Medium | `.github/workflows/ci.yml` audit step is still `--omit=dev --audit-level=high`. Parallel agent's plan calls for `npm audit --audit-level=moderate --include=dev` (non-blocking) plus a `postcss` override (already in `package.json`). |

### Open, manual one-off

| ID | Severity | Note |
|---|---|---|
| SEC-002b (review 04-26) | Low | `.env.local` and `secrets/*.txt` are mode 664 on the developer host. Mitigation: `chmod 600 .env.local secrets/*.txt`. Not a repo leak — files are gitignored. |

## Verification performed in this pass

```bash
npm run lint            # clean
npx tsc --noEmit        # clean
npm test                # 72 passed (was 56 baseline; +16 across phases)
npm run build           # green
docker compose -f docker-compose.local.yml up -d --build
curl http://127.0.0.1:7001/api/health           # 200 {"status":"ok"}
curl -X POST .../api/analyze -d '<sample>'       # 200 in 3.8s, valid schema
```

## Recommended next steps

1. Let the parallel hardening plan land (SEC-006 + bundled CI/Trivy
   tightening). Re-run `npm test` after to make sure nothing diverged.
2. If the deployment moves to a public k8s cluster, revisit SEC-N2 and
   migrate to `*_FILE` mounts. The application code already supports
   them via `lib/runtime-env.ts`.
3. Run `chmod 600 .env.local secrets/*.txt` on the dev workstation.
4. After the next Next.js minor release, prune `.trivyignore` entries
   whose vendored package was upgraded and verify with
   `trivy fs --scanners vuln --severity HIGH,CRITICAL .`.
