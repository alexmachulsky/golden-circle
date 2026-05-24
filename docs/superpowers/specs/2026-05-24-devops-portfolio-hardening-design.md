# Design: Portfolio-grade DevOps & Security Hardening

**Date:** 2026-05-24
**Status:** Approved design — pending implementation plan
**Goal lens:** Portfolio showcase. Maximize *recognizable, well-documented* DevOps/security
signals; keep the repository reading as intentional and low-rot. No new runtime dependencies
unless they clearly pay for themselves.

## Context

The Golden Circle Analyzer already has an unusually mature baseline: a 4-stage CI/CD pipeline
(build → verify → Trivy scan → GHCR publish with SBOM + SLSA provenance), SHA-pinned actions,
Dependabot, a hardened Dockerfile (non-root, pinned digest, `apk upgrade`, healthcheck,
standalone output), hardened Compose (read-only, `cap_drop: ALL`, `no-new-privileges`, tmpfs,
resource limits, Docker secrets), k8s manifests (namespace, deployment, service, ingress,
networkpolicy, rbac, configmap), and strong app-level defenses (6 request guards, rate limiting,
Turnstile, CSP, input sanitization).

This work refines that baseline for a public portfolio audience. The repository **is public**, so
publicly-visible signals (Security tab results, OpenSSF Scorecard badge) carry weight.

### Current state confirmed during exploration
- **CSP nonce middleware is inactive.** `proxy.ts` is a complete, correct Next.js middleware, but
  Next requires the file to be named `middleware.ts` with a `default` export. While inactive, CSP
  degrades to the `'unsafe-inline'` fallback. `security-headers.ts` and `app/layout.tsx` already
  support the per-request nonce.
- **Compose files are intentional, not drifted.** `docker-compose.yml` is the nginx-fronted
  production path (secrets, Upstash, Turnstile); `docker-compose.local.yml` is the LAN path with
  `DEPLOYMENT_MODE=local` + in-memory limiter. No reconciliation needed.
- **Uncommitted work is complete and tested.** The working tree contains a finished, 16-test
  share-link feature (already documented in CLAUDE.md) plus 5 legitimate security tweaks.
- **Logging** is ~14 server-side `console.*` call sites using a `[module]` prefix convention.
- **No `SECURITY.md`.** `docs/` holds a rich history of dated security reviews.
- Next.js `16.2.4`.

## Phases

Each phase is independent and separately verifiable. Execution order: 1 → 2 → 3 → 4. Standard
gates after each phase: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`.

### Phase 1 — CI security signals (additive, lowest risk)

- **CodeQL SAST** — new dedicated `.github/workflows/codeql.yml`.
  - Language: `javascript-typescript`.
  - Triggers: `push`/`pull_request` to `main` + weekly `schedule`.
  - Results upload to the GitHub Security tab.
  - Actions pinned by commit SHA (matches existing repo convention).
  - Rationale for a separate workflow (vs. a job in `ci.yml`): conventional, cleaner Security-tab
    integration, independent scheduling.
- **Secret scanning (gitleaks)** — new `secret-scan` job (in `ci.yml` or its own workflow;
  decided in the plan).
  - Diff scan on PR, full-history scan on schedule.
  - `.gitleaks.toml` allowlist for the public Cloudflare Turnstile **test** keys and the empty
    `secrets/*.txt` placeholder files, to avoid false positives.
- **OpenSSF Scorecard** — new `.github/workflows/scorecard.yml` + README badge (repo is public).
  - Weekly schedule + `branch_protection`-aware; results to Security tab and badge.

**Verification:** workflows parse (actionlint or a dry `act`/syntax check where feasible), and the
jobs are visible/green on a test push or PR.

### Phase 2 — Strict CSP activation

- Rename `proxy.ts` → `middleware.ts`; change `export function proxy` →
  `export default function middleware`. Keep the existing `config.matcher`.
- Confirm Next 16 middleware conventions against `node_modules/next/dist/docs/` before editing.
- Update the now-stale CLAUDE.md "currently inactive" note for `proxy.ts`/CSP.

**Verification gate (must observe before claiming done):**
1. `npm run build` succeeds.
2. Running the app, `curl -I` (or fetch) shows `Content-Security-Policy` `script-src` carrying
   `'nonce-…'` and **not** `'unsafe-inline'`.
3. Loading the page in a browser shows **zero** CSP console violations and clean hydration
   (Framer Motion runtime `style=` attributes remain covered by `style-src-attr 'unsafe-inline'`).

### Phase 3 — Commit & polish the in-progress work

- Commit the working-tree changes as **two logical commits**:
  1. `feat: shareable result links` — `lib/share-link.ts` + tests, `GoldenCircleApp` hash restore,
     `ResultSection` Share button.
  2. `fix: security hardening tweaks` — turnstileToken type guard, skip caching `__ERROR__`
     sentinels, tightened nonce regex, corrected control/bidi regex, Turnstile fail-closed when
     production has no allowed hostnames; plus the `analyze-cache` test reset.
- Confirm CLAUDE.md already documents share-link (it does); adjust only if wording drifts.

**Verification:** full gate green; `git status` clean afterward.

### Phase 4 — Docs + observability (structured logging only)

- **`lib/logger.ts`** — tiny, dependency-free JSON logger emitting `{ ts, level, msg, ...fields }`.
  - Replace the ~14 `console.*` call sites.
  - Thread a per-request `reqId` through `/api/analyze`; also return it as an `x-request-id`
    response header.
  - Redaction discipline: log error *messages* and outcomes, never secret values or raw user
    input. (Matches current habit.)
- **`SECURITY.md`** — vulnerability disclosure policy + supported versions (GitHub-recognized).
- **`docs/THREAT-MODEL.md`** — one canonical, current threat model: the 6-guard chain, trust
  boundaries, rate-limit/CSP/secret posture. Consolidates the historical reviews, which remain
  in place for provenance.
- **README architecture + request-flow diagram** — Mermaid: request → 6 guards → cache → Groq
  stream → client. Slots into the existing `How it works` / `CI/CD` sections.

**Verification:** logger has unit tests; `npm test` green; docs render (Mermaid syntax valid).

## Out of scope (YAGNI for a portfolio)

- Prometheus/Grafana or any metrics stack (explicitly chosen: structured logging only).
- Helm / Kustomize / Terraform rewrite of the existing k8s YAML.
- Multi-arch image builds.
- Runtime APM / tracing.

## Risks & mitigations

- **CSP activation breaks rendering under Next 16/Turbopack.** Mitigation: hard verification gate
  (build + header check + browser console check) before claiming done; revert is a one-line rename.
- **gitleaks false-positives on test keys / history.** Mitigation: `.gitleaks.toml` allowlist;
  validate against full history before enforcing.
- **Scorecard requires public repo & some checks need branch protection.** Repo is public;
  branch-protection-dependent checks will simply score lower until configured — acceptable.
