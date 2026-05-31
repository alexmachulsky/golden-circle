# Design — Golden Circle: Eval-Driven Agentic Strategy Engine

**Date:** 2026-05-31
**Status:** Approved (architecture); phases planned individually
**Author:** Alex Machulsky (with Claude Code)

## 1. Purpose & success criteria

Transform the Golden Circle Analyzer from a single-call LLM wrapper into a
**production-grade, rigorously-evaluated agentic RAG system, operated like real
infrastructure.**

The goal is portfolio differentiation for **high-paying AI/ML engineering roles**
(full-stack secondary). 2026 hiring research converges on one pattern:
**Agents + RAG + Evals + Production rigor**, with *evaluation* as the rarest
senior signal ("evals are the new unit tests"). This project's unfair advantage
is that it already has FAANG-grade production engineering (CI/CD, SLSA/cosign/SBOM
supply chain, Kyverno policy-as-code, k8s, security hardening). Adding a genuinely
sophisticated, *evaluated* AI system on top yields the rare profile: someone who
can both build a serious AI system **and** run it like production.

**Success criteria:**
- A multi-step agent that visibly researches, drafts, self-critiques, and refines.
- Grounded output with citations (RAG), for both free-text ideas and real companies.
- An evaluation harness wired into CI as a **regression gate**, with quality
  tracked over time.
- LLM-native + system-level observability (cost, latency, eval scores, traces).
- Live public demo; README that tells the end-to-end story with real eval numbers.

## 2. Non-goals (YAGNI)

- **User accounts / auth** — out of scope; history stays client-side + a server
  run-log keyed by anonymous id. (Accounts can be a later, separate project.)
- **Fine-tuning / training models** — we orchestrate and evaluate hosted models.
- **Replacing the existing security/guard layer** — it is reused unchanged.
- **A general agent framework** — we build exactly the pipeline this product needs.
- **Multi-framework analysis** (SWOT, BMC, etc.) — possible later; not in this spec.

## 3. Current state (reused, not rebuilt)

- Next.js 16 App Router, standalone Docker output; `/api/analyze` streams a single
  OpenRouter (`openai/gpt-oss-120b:free`) completion as `text/plain`; client
  assembles + parses JSON into `AnalysisResult`.
- Request guards (Content-Type, Origin, rate limit, body size, API key, Turnstile),
  `lib/analyze-cache.ts` (sha256-keyed), `lib/validate-analysis.ts`, structured
  logger (`lib/logger.ts`), zod env (`lib/env.ts`), CSP nonce middleware (`proxy.ts`).
- `AnalysisResult` = `{ why:{statement,depth_note}, how:HowItem[4], what:WhatItem[3],
  positioning_note }` (`types/index.ts`).
- These all remain. The agent pipeline replaces the *single LLM call* behind
  `/api/analyze`; guards/cache/validation wrap it as today.

## 4. Target architecture

Five bounded, independently-testable units plus the untouched security layer.

```
                       ┌──────────── Agent Orchestrator (typed step-graph) ────────────┐
 UI (SSE step stream) →│ Plan → Research → Retrieve(RAG) → Analyze → Critique → Refine → Validate │→ result+citations+scores
                       └────┬──────────────┬───────────────┬──────────────┬───────────────────────┘
                            │ tools         │ vector search │ Zod struct.  │ LLM-as-judge rubric
                       web search/fetch   pgvector KB      output          │
                            │                                              │
        ┌───────────────────┴────────────┐               ┌────────────────┴──────────────────┐
        │ Postgres + pgvector             │               │ Eval layer                          │
        │ KB embeddings · run history ·   │               │ golden dataset · promptfoo CI gate  │
        │ cached research · eval results  │               │ Langfuse online traces + scores     │
        └─────────────────────────────────┘               └─────────────────────────────────────┘
                            │
       OTel (GenAI conv.) → Collector → Prometheus + Tempo (+ Loki) → Grafana     [Phase 4]
```

### 4.1 Module boundaries

| Module (proposed path) | Responsibility | Depends on |
|---|---|---|
| `lib/agent/graph.ts` | Typed step-graph runner: executes nodes, threads state, emits events | step nodes, `lib/llm` |
| `lib/agent/steps/*.ts` | One file per node (plan, research, retrieve, analyze, critique, refine, validate) | `lib/llm`, `lib/rag`, `lib/tools` |
| `lib/agent/state.ts` | `AgentState` type + Zod schemas for each step's I/O | zod, `types` |
| `lib/llm/index.ts` | Model client + **router** (role→model), token/cost accounting | Vercel AI SDK, OpenRouter |
| `lib/rag/store.ts` | Vector store interface + pgvector impl (`upsert`, `query`) | Postgres, embeddings |
| `lib/rag/ingest.ts` | Corpus chunk→embed→upsert pipeline (CLI) | `lib/rag/store` |
| `lib/tools/search.ts` | Web search/fetch tool behind an interface (Tavily/Exa impl + mock) | provider SDK |
| `lib/evals/*` | Golden dataset loader, metric scorers, runner, report | `lib/agent`, judge model |
| `lib/observability/*` | Langfuse tracing wrapper; (P4) OTel setup | Langfuse SDK, OTel |
| `app/api/analyze/route.ts` | Wraps the graph in existing guards/cache; streams SSE events | `lib/agent`, guards |
| `components/AgentProgress.tsx` | Renders live step stream (research → draft → critique → refine) | — |

Design rule: every step node has signature `(state, ctx) => Promise<Partial<AgentState>>`,
is pure w.r.t. injected `ctx` (llm, tools, store, tracer), and is unit-testable with
mocked `ctx`. The graph runner owns control flow (the refine loop, caps, error handling).

## 5. The agent pipeline

Built on the **Vercel AI SDK** (`ai`) for model calls, tool calling, and
`generateObject`/`streamObject` with **Zod** structured output. A thin hand-rolled
**typed step-graph** owns orchestration (visible depth without a heavyweight framework).

Nodes:

1. **Plan/Route** — classify input (`idea` | `company`); produce a research plan;
   select models per role via the router. Cheap model.
2. **Research** (tool-using) — uses `search`/`fetch` tools. `company` mode: gather
   facts about the real business (products, positioning, market) with source URLs.
   `idea` mode: light market/competitor context. Output: `ResearchBrief { findings[], sources[] }`.
3. **Retrieve (RAG)** — embed the working context; vector-search the curated KB
   (Golden Circle principles + *good-vs-generic exemplars*) to ground style/fidelity.
   Output: `retrieved[] {text, source, score}`.
4. **Analyze** — `generateObject` against an extended schema → draft `AnalysisResult`
   + `citations[]` + per-section `confidence`. Strong model.
5. **Critique** — LLM-as-judge scores the draft on a rubric (§7.2) and returns
   `{ scores, weaknesses[], pass:boolean }`. Mid model, low temperature.
6. **Refine** — if `!pass` and `loops < MAX_REFINE`, rewrite addressing weaknesses;
   re-critique. `MAX_REFINE` configurable (default 2), and the actual loop count is
   logged/streamed — **no silent cap**.
7. **Validate** — final guard: Zod schema valid, 4 HOW / 3 WHAT, every non-obvious
   claim maps to a citation/source, reuse existing sanitization + `__ERROR__` defense.

Each node: emits an SSE event (`step.start`/`step.finish` with summary), records a
Langfuse span, and accumulates token/cost into `AgentState.usage`.

## 6. Data flow, streaming protocol, and data model

### 6.1 Streaming protocol
`/api/analyze` switches from raw `text/plain` to **SSE** (or AI SDK data-stream)
emitting typed events so the UI can show progress:
`{type:'step', step, status, summary?}`, `{type:'sources', items}`,
`{type:'draft', partial}`, `{type:'critique', scores, weaknesses}`,
`{type:'final', result}`, `{type:'error', message}`.
The `__ERROR__` sentinel contract is preserved inside the `error` event for
backward-compatible client handling. Cache stores only the final validated result.

### 6.2 Postgres + pgvector schema (one DB, three jobs)
- `kb_chunks(id, source, text, embedding vector, metadata jsonb)` — RAG corpus.
- `research_cache(key, company, brief jsonb, sources jsonb, created_at)` — cache
  expensive web research (TTL).
- `runs(id, mode, input_hash, result jsonb, usage jsonb, scores jsonb, created_at)` —
  run history + cost/score record (powers the trend dashboard; anonymous).
- `eval_results(id, run_id|dataset_case, metric, value, created_at)` — eval history.

Embeddings via a small embeddings model (OpenAI `text-embedding-3-small` or Voyage;
OpenRouter is chat-only). Embedding provider is behind `lib/rag/store.ts` so it is swappable.

### 6.3 Extended types
`AnalysisResult` gains optional `citations?: Citation[]` and
`confidence?: Record<'why'|'how'|'what', number>`; a `Citation = {claim, source, url}`.
Existing 4-HOW/3-WHAT invariant unchanged. `lib/prompt.ts`, `types/index.ts`,
`GoldenCircleApp.tsx` parsing, and `ResultSection.tsx` rendering update together
(per repo convention).

## 7. Evaluation design — the differentiator

### 7.1 Golden dataset
Versioned in-repo under `evals/dataset/` (JSON): a curated set of `idea` and
`company` cases, each with rubric expectations and (where applicable) known facts to
check grounding against. Small **CI subset** (~10 cases) + **full suite** (~40) for
nightly/manual runs.

### 7.2 Metrics
- **Output quality (LLM-as-judge, 1–5 + rationale):** specificity, non-genericness,
  framework fidelity, actionability, structural validity.
- **RAG metrics:** context precision, context recall, faithfulness/groundedness,
  citation accuracy.
- **Agent metrics:** step success rate, refinement-loop count, cost, latency.

### 7.3 CI eval gate (promptfoo)
A GitHub Actions job runs the **CI subset** through promptfoo on PRs and **fails on
regression** vs a committed baseline (per-metric thresholds + max-drop tolerance).
Cost/time bounded by subset size and a cheap judge model; the bound is documented and
logged (no silent truncation). Baselines + run outputs are committed so quality is a
**trend line**. Full suite runs nightly via `workflow_dispatch`/schedule.

### 7.4 Determinism & cost control
Judge model pinned; temperature 0 where possible; results cached by input hash;
CI uses the subset; a `EVALS_DISABLED` escape hatch lets forks build without keys.

## 8. Observability / LLMOps

- **Langfuse (self-hosted, OSS)** — primary LLM observability: per-run trace of every
  step, prompt, token, cost, latency, plus attached eval scores; dataset capture for
  online eval. Fits the existing self-hosted, reproducible ethos. Wrapped in
  `lib/observability/` so it degrades to a no-op when unconfigured.
- **Phase 4 — OTel (GenAI semantic conventions) → Collector → Prometheus + Tempo +
  Loki → Grafana**: RED metrics, cost dashboards, SLOs + multi-window burn-rate
  alerts, and a k6 load generator so dashboards show real data. (This absorbs the
  earlier standalone "observability" idea, now justified by a real system.)
- **Multi-model routing**: research=cheap, analyze=strong, judge=mid; the router
  records a quantified cost/latency story for the README.

## 9. Error handling & security

- Reuse all existing guards, rate limiting, body limits, Turnstile, CSP nonce.
- New failure modes handled in the graph runner: tool/search failure (degrade to
  ungrounded analysis with a flag), retrieval empty (proceed, lower confidence),
  judge failure (skip gate, log), refine-loop exhaustion (return best-so-far, flag),
  embeddings/DB down (RAG disabled, app still works). Every external call is
  timeout-bounded and failures are logged via `lib/logger.ts` (no secrets/raw input).
- Prompt-injection: research content is untrusted; it is delimited and the analyst
  is instructed to treat it as data; the existing `__ERROR__` preamble scan + output
  sanitization remain the last line of defense.

## 10. Tech stack

| Concern | Choice | Alt considered |
|---|---|---|
| Orchestration | Vercel AI SDK + typed step-graph | LangGraph.js; hand-rolled |
| Models | OpenRouter + role router | direct provider SDKs |
| RAG store | Postgres + pgvector | Qdrant; LanceDB |
| Embeddings | OpenAI `text-embedding-3-small` / Voyage | local model |
| Web research | Tavily / Exa + fetch | Brave/SerpAPI |
| CI eval gate | promptfoo | DeepEval |
| LLM tracing/eval | Langfuse (self-hosted) | Braintrust (hosted) |
| System obs (P4) | OTel → Prometheus/Tempo/Loki/Grafana | Grafana Cloud |

## 11. Phasing (each phase ships something demoable)

- **P0 — Foundations:** migrate to Vercel AI SDK; extend schemas (citations,
  confidence); switch `/api/analyze` to SSE step events; UI renders steps. Output
  unchanged but flows through the new single-step graph. *Done when:* parity output,
  steps visible, tests/lint/types/build green.
- **P1 — Agentic core:** plan→analyze→critique→refine reflection loop; scores shown;
  self-correction demoable. *Done when:* drafts measurably improve after critique on
  sample inputs; loop count streamed.
- **P2 — Grounding/RAG:** pgvector KB + ingest CLI + retriever; `company` mode with
  web research + citations. *Done when:* a real company yields cited, grounded output.
- **P3 — Eval harness + CI gate:** golden dataset, metric scorers, promptfoo CI gate,
  committed baseline + trend. *Done when:* a deliberate quality regression fails CI.
- **P4 — LLMOps:** Langfuse traces; OTel→Grafana dashboards; SLOs + burn-rate alerts;
  k6 load gen; multi-model routing + cost story. *Done when:* dashboards show real
  runs and a cost/latency comparison is documented.
- **P5 — Ship + polish:** live public deploy; README with architecture diagram, eval
  numbers, screenshots, and supply-chain verification. *Done when:* clickable demo +
  story complete.

Each phase is its own spec→plan→implement cycle. **First implementation plan covers
P0→P1.**

## 12. Testing strategy

- **Unit:** each step node with mocked `ctx` (Vitest, existing setup). Router, vector
  store (against a test Postgres or an in-memory fake), tool adapters (mocked HTTP).
- **Contract:** Zod schemas validated for every step I/O; `validate` node tests for
  4-HOW/3-WHAT, citation mapping, sanitization, `__ERROR__` defense.
- **Eval (offline):** the golden-dataset runner is itself the integration test of
  quality; promptfoo subset in CI.
- **Component:** `AgentProgress` smoke test (existing `components/__tests__/` pattern).
- **No network in unit tests:** search/embeddings/LLM are injected and mocked.

## 13. Risks & mitigations

- **Cost (LLM-heavy evals/agents):** subset in CI, caching, cheap models for
  research/judge, free-tier where possible, `EVALS_DISABLED` escape hatch.
- **Scope creep:** strict phasing; each phase independently shippable; non-goals fixed.
- **Free-tier rate limits (OpenRouter 50/day, 20/min):** router can target paid models
  for evals; cache aggressively; document limits in README.
- **Determinism of LLM evals:** pinned judge model, temp 0, rationale logged, tolerance
  bands rather than exact-match.
- **pgvector/infra weight locally:** compose profiles so the base app still runs
  without the full stack; RAG/observability degrade gracefully when unconfigured.

## 14. Open questions

- Embeddings provider final pick (OpenAI vs Voyage) — decide at P2 based on cost/quality.
- Search provider (Tavily vs Exa) — decide at P2 via a quick spike; both behind the
  same tool interface, so low-risk.

These are deferred, low-risk, and isolated behind interfaces; they do not block P0→P1.
