# Security Policy

## Supported Versions

This project is deployed as a single rolling release from `main`. Only the
latest `main` (and the most recently published container image) receives
security fixes.

| Version | Supported |
| ------- | --------- |
| `main` (latest) | ✅ |
| older commits / tags | ❌ |

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public issue.

1. Use GitHub's **Report a vulnerability** button under the repository's
   **Security** tab (Private Vulnerability Reporting), or
2. Email the maintainer listed on the GitHub profile.

Include: affected endpoint/file, reproduction steps, and impact. You can expect
an acknowledgement within 7 days and a status update within 30 days.

## Scope

In scope: the application code (`app/`, `lib/`, `components/`), the API route
(`/api/analyze`), the container image, and the CI/CD pipeline.

Out of scope: third-party services (Groq, Cloudflare Turnstile, Upstash) — report
those to the respective vendors. Denial-of-service via the documented rate limits
is expected behavior, not a vulnerability.

## Security Model

See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for the trust boundaries,
request-guard chain, and hardening posture.
