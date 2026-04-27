# Security Review - 2026-04-26

## Scope

Read-only security review of the Next.js application, Docker/Compose setup, Kubernetes manifests, CI, dependency posture, and local secret handling.

No source code was modified during the review.

## Executive Summary

No critical application-code vulnerability was found. The main residual risks are deployment/configuration issues rather than classic injection bugs: Compose can still promote `.env.local` secrets into container environment variables, local secret files are too broadly readable, and the current Compose file does not match the README's stated nginx-fronted deployment posture.

The `/api/analyze` endpoint is already hardened with JSON-only requests, origin checks, body-size limits, production fail-closed rate limiting, optional Turnstile, generic upstream errors, and response schema validation before rendering.

## Findings

### SEC-001: Compose Can Expose or Override Runtime Secrets

- Severity: Medium
- Location: `docker-compose.yml:37`, `docker-compose.yml:34-36`, `lib/runtime-env.ts:22-29`, `.env.local.example:1-4`
- Evidence:

```yaml
env_file:
  - .env.local
```

```ts
const directValue = env[name]?.trim()
if (directValue) {
  return directValue
}
```

- Impact: If `.env.local` contains real values such as `GROQ_API_KEY`, direct environment variables take precedence over Docker secret files. Those secrets can become visible through container environment inspection, process dumps, crash reporting, or orchestration UIs.
- Fix: Split non-secret runtime config into a separate env file, for example `.env.runtime`, and keep `.env.local` for local development only. Alternatively, make file-backed secrets win over direct env vars in production.
- Mitigation: Keep `.env.local` out of production deployments and verify `docker inspect` does not show secret values.
- False positive notes: This is only a production/runtime exposure if real secrets are placed in `.env.local` and that file is loaded by Compose.

### SEC-002: Local Secret Files Are World-Readable to Same-Host Users

- Severity: Medium
- Location: `.env.local`, `secrets/groq_api_key.txt`, `secrets/turnstile_secret_key.txt`, `secrets/upstash_redis_rest_token.txt`
- Evidence:

```text
664 alex:alex ./.env.local
664 alex:alex secrets/groq_api_key.txt
664 alex:alex secrets/turnstile_secret_key.txt
664 alex:alex secrets/upstash_redis_rest_token.txt
```

- Impact: On a shared development host, another local user in the relevant permission path may read API keys or tokens.
- Fix: Set local secret file permissions to owner-only, for example `chmod 600 .env.local secrets/*.txt`.
- Mitigation: Prefer Docker/Kubernetes/cloud secret stores for production and avoid long-lived plaintext secrets in the repo working tree.
- False positive notes: The files are ignored by git and were not tracked, so this is a local-host exposure rather than a repository leak.

### SEC-003: Compose Publishes the App Directly While README Describes an Nginx-Fronted Stack

- Severity: Medium for public/LAN use, Low for localhost-only development
- Location: `docker-compose.yml:10-11`, `docker-compose.yml:23-29`, `README.md:92`, `nginx.conf:1-32`
- Evidence:

```yaml
ports:
  - "7001:7001"
environment:
  NODE_ENV: production
  DEPLOYMENT_MODE: local
```

README says:

```text
The compose stack now fronts the app with the bundled `nginx.conf`, publishes only `127.0.0.1:7001`, and sets `TRUSTED_IP_HEADER=x-real-ip`
```

- Impact: If used outside localhost, traffic reaches Next.js directly without the intended reverse proxy controls. `DEPLOYMENT_MODE=local` also allows the single-process in-memory limiter instead of requiring the public production shared limiter and trusted client identity header.
- Fix: Bind Compose to localhost for local-only use, for example `127.0.0.1:7001:7001`, or add an nginx service that uses `nginx.conf`, strips spoofed IP headers, and sets `TRUSTED_IP_HEADER=x-real-ip`.
- Mitigation: Do not use this Compose file for public exposure until proxy/TLS/rate-limit identity wiring is explicit.
- False positive notes: If Compose is only used on a trusted workstation via localhost, this is mostly documentation drift and defense-in-depth.

### SEC-004: Turnstile Validation Accepts Any Successful Token Without Hostname or Action Checks

- Severity: Low to Medium
- Location: `lib/turnstile.ts:6-8`, `lib/turnstile.ts:93-101`, `components/TurnstileWidget.tsx:76-88`
- Evidence:

```ts
interface TurnstileResponse {
  success?: boolean
}
```

```ts
if (!payload.success) {
  throw new TurnstileError(403, "Verification failed.", "Turnstile rejected the submitted token.")
}
```

- Impact: The app relies only on Cloudflare's `success` result. Defense-in-depth is weaker because the server does not verify that the token was issued for the expected hostname or action.
- Fix: Configure an explicit Turnstile `action` in the widget and validate `hostname` and `action` in the Siteverify response.
- Mitigation: Keep Turnstile site keys scoped correctly in Cloudflare and keep origin checks/rate limiting enabled.
- False positive notes: Cloudflare still verifies token authenticity and site-secret pairing. This finding is hardening, not a confirmed bypass.
- Reference: <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>

## Positive Security Checks

- `/api/analyze` enforces `Content-Type: application/json`.
- `/api/analyze` validates request origin against configured allowed origins.
- Request bodies are limited to 8 KB and parsed manually with an enforced byte cap.
- Production rate limiting fails closed unless shared Upstash config and trusted client identity are configured, except when explicitly using `DEPLOYMENT_MODE=local`.
- Upstash URL handling enforces HTTPS and rejects obvious private-network hosts.
- LLM output is parsed and schema-validated before rendering.
- React output is rendered through normal JSX text nodes; no unsafe `dangerouslySetInnerHTML` rendering path was found for LLM output.
- CSP and common hardening headers are configured in `proxy.ts`, `lib/security-headers.ts`, and `next.config.ts`.
- Dockerfile uses a multi-stage build, non-root runtime user, dropped dev dependencies, and a pinned base image digest.
- CI pins GitHub Actions by commit SHA and runs tests, lint, type-check, npm audit, Docker build, and Trivy.

## Verification Performed

```bash
git status --short
git ls-files .env.local secrets .next .playwright-mcp .worktrees docs
rg -n "dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\\.write|eval\\(|new Function|localStorage|sessionStorage|window\\.location|process\\.env|request\\.json\\(|fetch\\(|Set-Cookie|Content-Security-Policy|fs\\.|path\\.join|child_process" -g '!node_modules' -g '!.next' -g '!.git' -g '!.worktrees'
npm audit --audit-level=high --omit=dev
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --skip-dirs node_modules --skip-dirs .next --skip-dirs .worktrees --quiet .
```

Results:

- `git status --short` showed only an unrelated untracked prior report before this file was added.
- Secret files and `.env.local` are ignored by git; only `secrets/.gitkeep` is tracked under `secrets/`.
- `npm audit --omit=dev` reported no high or critical production dependency advisories. It did report two moderate PostCSS advisories through Next's bundled dependency.
- `trivy fs` reported no high or critical vulnerability findings after its vulnerability DB was downloaded.

## Follow-Up Priority

1. Fix `SEC-001` and `SEC-003` together by making Compose match the intended nginx/proxy/secret-file deployment model.
2. Fix `SEC-002` immediately on the local workstation with file permissions.
3. Add Turnstile hostname/action validation as a defense-in-depth hardening task.
