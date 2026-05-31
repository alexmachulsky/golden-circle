# P1 — Agentic Reflection Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **ENVIRONMENT NOTE (2026-05-31):** The shared host disk is ~100% full. Implement INLINE (avoid spawning many subagents whose `/tmp` transcripts fail under ENOSPC). Verify each task with `npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint` (all low-disk). DEFER `npm run build` + `docker compose up --build` until disk is freed; note that in the final report rather than claiming them done.

**Goal:** Turn the single-step analyzer into a visible **reflection loop** — analyze → critique → (refine if weak) → validate — using Zod **structured output**, streamed to the client as typed **ndjson events** and rendered as live step progress with the critique score.

**Architecture:** Each node is a pure `(…, ctx) => Promise<…>` using the AI SDK's `generateObject` with a Zod schema (no brittle text parsing). The graph runner orchestrates the loop, emits typed events via an injected `emit`, and returns the final validated `Analysis`. The route streams those events as `application/x-ndjson`; the client accumulates events, shows `AgentProgress`, and renders the final result. Token-streaming is replaced by per-step progress events — a better fit for a multi-step agent.

**Tech Stack:** Next.js 16, Vercel AI SDK v5 (`generateObject`), Zod 4, Vitest, Framer Motion.

Builds on P0 (`lib/agent/{state,llm,graph,steps/analyze}.ts`). Follows the spec `docs/superpowers/specs/2026-05-31-eval-driven-agentic-strategy-engine-design.md`.

**Deliberate trim:** the spec's separate *plan* node is deferred to P2 (it earns its keep with company-mode routing). P1 ships the reflection loop — the headline "agent self-corrects" capability.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/analysis-schema.ts` | Create | Zod `analysisSchema` (+ optional `citations`/`confidence`) → single source of truth; `Analysis` type |
| `lib/analysis-schema.test.ts` | Create | accept/reject (4 HOW / 3 WHAT, optional extras) |
| `lib/agent/events.ts` | Create | `AgentEvent` union + `encodeEvent`/`parseEventLines` (ndjson) |
| `lib/agent/events.test.ts` | Create | encode/parse round-trip, partial-line buffering |
| `lib/agent/critique-schema.ts` | Create | Zod `critiqueSchema` (`scores`, `overall`, `weaknesses`, `pass`); `Critique` type |
| `lib/prompt.ts` | Modify | add `CRITIQUE_SYSTEM_PROMPT`, `buildCritiquePrompt`, `REFINE_SYSTEM_PROMPT`, `buildRefinePrompt` |
| `lib/agent/steps/analyze.ts` | Rewrite | `generateObject` → `Analysis` (was: text generator) |
| `lib/agent/steps/critique.ts` | Create | `generateObject` → `Critique` |
| `lib/agent/steps/refine.ts` | Create | `generateObject` → improved `Analysis` |
| `lib/agent/graph.ts` | Rewrite | `runAnalysis(input, ctx)` reflection loop, emits events, returns `Analysis` |
| `lib/agent/graph.test.ts` | Rewrite | loop + event-order tests with mocked nodes |
| `lib/validate-analysis.ts` | Modify | `validateShape` allowlist tolerates `citations`/`confidence`; add `sanitizeAnalysis()` |
| `app/api/analyze/route.ts` | Modify | stream ndjson events; cache final JSON; guards unchanged |
| `app/api/analyze/route.test.ts` | Modify | assert ndjson event bodies (mock `runAnalysis`) |
| `components/AgentProgress.tsx` | Create | live step list + critique score during loading |
| `components/GoldenCircleApp.tsx` | Modify | consume ndjson events; render `AgentProgress`; drop raw-text path |

`AgentContext` gains `emit: (e: AgentEvent) => void` (P0 had `{model, signal}`).

---

## Task 1: Analysis schema (single source of truth)  ← inline, TDD

**Files:** Create `lib/analysis-schema.ts`, `lib/analysis-schema.test.ts`

- [ ] **Step 1 — failing test** `lib/analysis-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analysisSchema } from "@/lib/analysis-schema";

const how = { title: "t", description: "d", uniqueness: "u" };
const what = { title: "t", description: "d", why_connection: "w" };
const valid = () => ({
  why: { statement: "s", depth_note: "n" },
  how: [how, how, how, how],
  what: [what, what, what],
  positioning_note: "p",
});

describe("analysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(analysisSchema.safeParse(valid()).success).toBe(true);
  });
  it("rejects wrong how length", () => {
    expect(analysisSchema.safeParse({ ...valid(), how: [how, how, how] }).success).toBe(false);
  });
  it("rejects wrong what length", () => {
    expect(analysisSchema.safeParse({ ...valid(), what: [what, what] }).success).toBe(false);
  });
  it("accepts optional citations + confidence", () => {
    expect(analysisSchema.safeParse({
      ...valid(),
      citations: [{ claim: "c", source: "Acme 10-K", url: "https://example.com" }],
      confidence: { why: 0.9, how: 0.8, what: 0.7 },
    }).success).toBe(true);
  });
});
```
- [ ] **Step 2 — run, expect FAIL:** `npx vitest run lib/analysis-schema.test.ts`
- [ ] **Step 3 — implement** `lib/analysis-schema.ts`:
```ts
import { z } from "zod";

// Single source of truth for the analysis shape: AI SDK structured output,
// server validation, and the inferred type all derive from this. The 4-HOW /
// 3-WHAT invariant lives here. citations/confidence are optional and unused
// until P2; declared now so the wire shape is stable.
export const citationSchema = z.object({
  claim: z.string(),
  source: z.string(),
  url: z.string().url().optional(),
});

export const analysisSchema = z.object({
  why: z.object({ statement: z.string(), depth_note: z.string() }),
  how: z.array(z.object({
    title: z.string(), description: z.string(), uniqueness: z.string(),
  })).length(4),
  what: z.array(z.object({
    title: z.string(), description: z.string(), why_connection: z.string(),
  })).length(3),
  positioning_note: z.string(),
  citations: z.array(citationSchema).optional(),
  confidence: z.object({ why: z.number(), how: z.number(), what: z.number() }).optional(),
});

export type Analysis = z.infer<typeof analysisSchema>;
```
- [ ] **Step 4 — run, expect PASS** (4 tests).
- [ ] **Step 5 — commit:** `feat(agent): add zod analysis schema as single source of truth`

---

## Task 2: Event protocol  ← inline, TDD

**Files:** Create `lib/agent/events.ts`, `lib/agent/events.test.ts`

- [ ] **Step 1 — failing test** `lib/agent/events.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeEvent, parseEventLines, type AgentEvent } from "@/lib/agent/events";

describe("agent event codec", () => {
  it("encodes one newline-terminated JSON line", () => {
    const out = encodeEvent({ type: "step", step: "analyze", status: "start" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });
  it("round-trips a sequence", () => {
    const evts: AgentEvent[] = [
      { type: "step", step: "analyze", status: "start" },
      { type: "error", message: "boom" },
    ];
    const { events, rest } = parseEventLines(evts.map(encodeEvent).join(""));
    expect(events).toEqual(evts);
    expect(rest).toBe("");
  });
  it("keeps a trailing partial line in rest", () => {
    const buf = encodeEvent({ type: "step", step: "critique", status: "finish" }) + '{"type":"er';
    const { events, rest } = parseEventLines(buf);
    expect(events).toHaveLength(1);
    expect(rest).toBe('{"type":"er');
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `lib/agent/events.ts`:
```ts
import type { Analysis } from "@/lib/analysis-schema";
import type { Critique } from "@/lib/agent/critique-schema";

export type StepName = "analyze" | "critique" | "refine";

export type AgentEvent =
  | { type: "step"; step: StepName; status: "start" | "finish"; summary?: string }
  | { type: "draft"; result: Analysis }
  | { type: "critique"; critique: Critique }
  | { type: "final"; result: Analysis }
  | { type: "error"; message: string };

export function encodeEvent(event: AgentEvent): string {
  return JSON.stringify(event) + "\n";
}

// Parse all complete lines; return events + trailing partial line for the next chunk.
export function parseEventLines(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line) as AgentEvent); } catch { /* skip bad line */ }
  }
  return { events, rest };
}
```
- [ ] **Step 4 — run, expect PASS** (note: imports `critique-schema` from Task 3; create Task 3 first if tsc complains, or land 1→3→2. Implementation order in this plan: do Task 3 before Task 2's tsc check).
- [ ] **Step 5 — commit:** `feat(agent): add ndjson agent event protocol`

---

## Task 3: Critique schema  ← inline, TDD

**Files:** Create `lib/agent/critique-schema.ts`, `lib/agent/critique-schema.test.ts`

- [ ] **Step 1 — failing test**:
```ts
import { describe, it, expect } from "vitest";
import { critiqueSchema } from "@/lib/agent/critique-schema";

const valid = {
  scores: { specificity: 4, nongeneric: 5, fidelity: 4, actionability: 3 },
  overall: 4,
  weaknesses: ["HOW #2 is generic"],
  pass: true,
};
describe("critiqueSchema", () => {
  it("accepts a well-formed critique", () => {
    expect(critiqueSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a score out of 1..5", () => {
    expect(critiqueSchema.safeParse({ ...valid, scores: { ...valid.scores, specificity: 9 } }).success).toBe(false);
  });
  it("rejects a missing pass flag", () => {
    const { pass: _omit, ...rest } = valid;
    expect(critiqueSchema.safeParse(rest).success).toBe(false);
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `lib/agent/critique-schema.ts`:
```ts
import { z } from "zod";

const score = z.number().int().min(1).max(5);

// Structured output of the critique node. Drives the refine decision and the
// score shown in the UI.
export const critiqueSchema = z.object({
  scores: z.object({
    specificity: score,
    nongeneric: score,
    fidelity: score,
    actionability: score,
  }),
  overall: z.number().min(1).max(5),
  weaknesses: z.array(z.string()),
  pass: z.boolean(),
});

export type Critique = z.infer<typeof critiqueSchema>;
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `feat(agent): add critique schema for the reflection loop`

---

## Task 4: Critique + refine prompts  ← inline

**Files:** Modify `lib/prompt.ts` (append; do not change existing exports)

- [ ] **Step 1 — append** to `lib/prompt.ts`:
```ts
// ── Reflection-loop prompts (P1) ────────────────────────────────────────────
export const CRITIQUE_SYSTEM_PROMPT = `You are a ruthless strategy editor reviewing a Golden Circle analysis.
Score the draft 1-5 on each axis (5 = excellent):
- specificity: concrete, non-obvious, tailored to THIS business (not boilerplate)
- nongeneric: a competitor could NOT paste the same text into their deck
- fidelity: correct use of the framework (WHY is a belief that passes the product-swap test; HOW are ownable; WHAT framed as proof of the WHY)
- actionability: a founder could act on it
Set "overall" to the mean. List concrete "weaknesses" (each names the exact item, e.g. "HOW #2"). Set "pass" to true only if every score is >= 4. Respond with the structured object only.`;

export function buildCritiquePrompt(businessIdea: string, draft: unknown): string {
  return `<business_idea>\n${businessIdea}\n</business_idea>\n\n<draft_analysis>\n${JSON.stringify(draft)}\n</draft_analysis>\n\nCritique the draft against the rubric.`;
}

export const REFINE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\nYou are REVISING an existing draft to fix specific weaknesses. Keep what works; rewrite weak items to be more specific and ownable. Preserve exactly 4 HOW and 3 WHAT items.`;

export function buildRefinePrompt(businessIdea: string, draft: unknown, weaknesses: string[]): string {
  return `<business_idea>\n${businessIdea}\n</business_idea>\n\n<previous_draft>\n${JSON.stringify(draft)}\n</previous_draft>\n\n<weaknesses_to_fix>\n${weaknesses.map((w) => `- ${w}`).join("\n")}\n</weaknesses_to_fix>\n\nProduce an improved analysis addressing every weakness.`;
}
```
- [ ] **Step 2 — verify:** `npx tsc --noEmit` (uses existing `SYSTEM_PROMPT`).
- [ ] **Step 3 — commit:** `feat(prompt): add critique and refine prompts`

---

## Task 5: Structured nodes (analyze rewrite, critique, refine)  ← inline

**Files:** Rewrite `lib/agent/steps/analyze.ts`; Create `lib/agent/steps/critique.ts`, `lib/agent/steps/refine.ts`

- [ ] **Step 1 — rewrite** `lib/agent/steps/analyze.ts`:
```ts
import { generateObject } from "ai";
import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

const MAX_OUTPUT_TOKENS = 4096;

// Produce a schema-valid draft analysis (structured output — no text parsing).
export async function analyzeStep(input: AgentInput, ctx: AgentContext): Promise<Analysis> {
  const { object } = await generateObject({
    model: ctx.model,
    schema: analysisSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input.text, input.refinement),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: ctx.signal,
  });
  return object;
}
```
- [ ] **Step 2 — create** `lib/agent/steps/critique.ts`:
```ts
import { generateObject } from "ai";
import { critiqueSchema, type Critique } from "@/lib/agent/critique-schema";
import type { Analysis } from "@/lib/analysis-schema";
import { CRITIQUE_SYSTEM_PROMPT, buildCritiquePrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

export async function critiqueStep(input: AgentInput, draft: Analysis, ctx: AgentContext): Promise<Critique> {
  const { object } = await generateObject({
    model: ctx.model,
    schema: critiqueSchema,
    system: CRITIQUE_SYSTEM_PROMPT,
    prompt: buildCritiquePrompt(input.text, draft),
    maxOutputTokens: 1024,
    abortSignal: ctx.signal,
  });
  return object;
}
```
- [ ] **Step 3 — create** `lib/agent/steps/refine.ts`:
```ts
import { generateObject } from "ai";
import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { REFINE_SYSTEM_PROMPT, buildRefinePrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

const MAX_OUTPUT_TOKENS = 4096;

export async function refineStep(
  input: AgentInput, draft: Analysis, weaknesses: string[], ctx: AgentContext,
): Promise<Analysis> {
  const { object } = await generateObject({
    model: ctx.model,
    schema: analysisSchema,
    system: REFINE_SYSTEM_PROMPT,
    prompt: buildRefinePrompt(input.text, draft, weaknesses),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: ctx.signal,
  });
  return object;
}
```
- [ ] **Step 4 — add `emit` to context.** Edit `lib/agent/state.ts`: add to `AgentContext`:
```ts
import type { AgentEvent } from "@/lib/agent/events";
// ...inside AgentContext:
  emit: (event: AgentEvent) => void;
```
- [ ] **Step 5 — verify:** `npx tsc --noEmit`.
- [ ] **Step 6 — commit:** `feat(agent): structured analyze/critique/refine nodes`

---

## Task 6: Graph reflection loop  ← inline, TDD

**Files:** Rewrite `lib/agent/graph.ts`, `lib/agent/graph.test.ts`

- [ ] **Step 1 — failing test** `lib/agent/graph.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

const draft = {
  why: { statement: "s", depth_note: "n" },
  how: Array.from({ length: 4 }, () => ({ title: "t", description: "d", uniqueness: "u" })),
  what: Array.from({ length: 3 }, () => ({ title: "t", description: "d", why_connection: "w" })),
  positioning_note: "p",
};
const refined = { ...draft, positioning_note: "p2" };

vi.mock("@/lib/agent/steps/analyze", () => ({ analyzeStep: vi.fn(async () => draft) }));
vi.mock("@/lib/agent/steps/critique", () => ({ critiqueStep: vi.fn() }));
vi.mock("@/lib/agent/steps/refine", () => ({ refineStep: vi.fn(async () => refined) }));

import { runAnalysis } from "@/lib/agent/graph";
import { critiqueStep } from "@/lib/agent/steps/critique";
import type { AgentContext } from "@/lib/agent/state";
import type { AgentEvent } from "@/lib/agent/events";

function ctxWith(events: AgentEvent[]): AgentContext {
  return { model: {} as never, signal: new AbortController().signal, emit: (e) => events.push(e) };
}
const passing = { scores: { specificity: 5, nongeneric: 5, fidelity: 5, actionability: 5 }, overall: 5, weaknesses: [], pass: true };
const failing = { scores: { specificity: 2, nongeneric: 2, fidelity: 3, actionability: 3 }, overall: 2.5, weaknesses: ["HOW #2 generic"], pass: false };

describe("runAnalysis reflection loop", () => {
  it("returns the draft and skips refine when critique passes", async () => {
    vi.mocked(critiqueStep).mockResolvedValueOnce(passing as never);
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(draft);
    expect(events.map((e) => e.type)).toEqual(["step","draft","step","step","critique","step","final"]);
    expect(events.some((e) => e.type === "step" && e.step === "refine")).toBe(false);
  });
  it("refines and returns the refined result when critique fails", async () => {
    vi.mocked(critiqueStep).mockResolvedValueOnce(failing as never);
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(refined);
    expect(events.some((e) => e.type === "step" && e.step === "refine" && e.status === "finish")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "final", result: refined });
  });
  it("emits an error event and rethrows when a step throws", async () => {
    const mod = await import("@/lib/agent/steps/analyze");
    vi.mocked(mod.analyzeStep).mockRejectedValueOnce(new Error("model down"));
    const events: AgentEvent[] = [];
    await expect(runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events))).rejects.toThrow("model down");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `lib/agent/graph.ts`:
```ts
import { analyzeStep } from "@/lib/agent/steps/analyze";
import { critiqueStep } from "@/lib/agent/steps/critique";
import { refineStep } from "@/lib/agent/steps/refine";
import type { Analysis } from "@/lib/analysis-schema";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// Bounded so free-tier cost stays predictable; the actual count is logged via
// events (no silent cap).
const MAX_REFINE = 1;

// Reflection loop: analyze → critique → (refine if weak) → final. Emits typed
// step/draft/critique/final events; returns the best validated Analysis.
export async function runAnalysis(input: AgentInput, ctx: AgentContext): Promise<Analysis> {
  try {
    ctx.emit({ type: "step", step: "analyze", status: "start" });
    let best = await analyzeStep(input, ctx);
    ctx.emit({ type: "draft", result: best });
    ctx.emit({ type: "step", step: "analyze", status: "finish" });

    for (let i = 0; i < MAX_REFINE; i++) {
      ctx.emit({ type: "step", step: "critique", status: "start" });
      const critique = await critiqueStep(input, best, ctx);
      ctx.emit({ type: "critique", critique });
      ctx.emit({ type: "step", step: "critique", status: "finish" });
      if (critique.pass) break;

      ctx.emit({ type: "step", step: "refine", status: "start", summary: `${critique.weaknesses.length} issue(s)` });
      best = await refineStep(input, best, critique.weaknesses, ctx);
      ctx.emit({ type: "step", step: "refine", status: "finish" });
    }

    ctx.emit({ type: "final", result: best });
    return best;
  } catch (err) {
    ctx.emit({ type: "error", message: "Analysis failed. Please try again." });
    throw err;
  }
}
```
- [ ] **Step 4 — run, expect PASS** (3 tests). Note: when `pass` is true the loop runs once (critique only); when false it runs critique+refine once (MAX_REFINE=1) — matches the event sequences asserted.
- [ ] **Step 5 — commit:** `feat(agent): reflection loop graph (analyze→critique→refine)`

---

## Task 7: validate-analysis — tolerate optional keys + sanitizeAnalysis  ← inline

**Files:** Modify `lib/validate-analysis.ts` (+ keep `lib/validate-analysis.test.ts` green)

- [ ] **Step 1 — extend the allowlist** in `validateShape` so caching a structured result with optional fields doesn't fail. Change:
```ts
  const allowed = new Set(["why", "how", "what", "positioning_note"]);
```
to:
```ts
  const allowed = new Set(["why", "how", "what", "positioning_note", "citations", "confidence"]);
```
- [ ] **Step 2 — add** `sanitizeAnalysis` (reuses `sanitizeOutputString`) at the end of the file:
```ts
import type { AnalysisResult } from "@/types"; // (already imported at top — do not duplicate)

// Strip control/bidi chars from every string field of a structured analysis
// before it leaves the server (defense in depth alongside render-time sanitizing).
export function sanitizeAnalysis(a: AnalysisResult): AnalysisResult {
  return {
    why: { statement: sanitizeOutputString(a.why.statement), depth_note: sanitizeOutputString(a.why.depth_note) },
    how: a.how.map((h) => ({ title: sanitizeOutputString(h.title), description: sanitizeOutputString(h.description), uniqueness: sanitizeOutputString(h.uniqueness) })),
    what: a.what.map((w) => ({ title: sanitizeOutputString(w.title), description: sanitizeOutputString(w.description), why_connection: sanitizeOutputString(w.why_connection) })),
    positioning_note: sanitizeOutputString(a.positioning_note),
  };
}
```
(If `AnalysisResult` is already imported at the top of the file, do NOT add a second import — just add the function.)
- [ ] **Step 3 — run:** `npx vitest run lib/validate-analysis.test.ts` → PASS. `npx tsc --noEmit` → clean.
- [ ] **Step 4 — commit:** `feat(validate): tolerate optional keys; add sanitizeAnalysis`

---

## Task 8: Route → ndjson event stream  ← inline

**Files:** Modify `app/api/analyze/route.ts`, `app/api/analyze/route.test.ts`

- [ ] **Step 1 — route imports.** Replace `import { runAnalysisStream } from "@/lib/agent/graph";` with:
```ts
import { runAnalysis } from "@/lib/agent/graph";
import { encodeEvent, type AgentEvent } from "@/lib/agent/events";
import { sanitizeAnalysis } from "@/lib/validate-analysis";
```
(Keep `getModel`.)

- [ ] **Step 2 — headers.** Change `STREAM_HEADERS` Content-Type to ndjson:
```ts
const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
```

- [ ] **Step 3 — cache hit emits a final event.** Replace the cache-hit block body:
```ts
  if (cached) {
    logger.info("analyze", { reqId, cache: "hit", status: 200 });
    const event = encodeEvent({ type: "final", result: JSON.parse(cached) });
    return new Response(event, { headers: streamHeaders });
  }
```
(Drop the prior `cached && !cached.includes("__ERROR__")` text guard; cache only ever holds validated JSON now.)

- [ ] **Step 4 — replace the streaming body.** Replace the whole `const readable = new ReadableStream({ ... })` (the raw-text loop, injection scan, byte cap, flush, catch) with:
```ts
  const model = getModel(apiKey);
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
      req.signal.addEventListener("abort", () => ac.abort(), { once: true });

      const emit = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));
      try {
        const analysis = await runAnalysis(
          { mode: "idea", text: sanitized, refinement },
          { model, signal: ac.signal, emit: (e) => {
            // Sanitize any analysis payload before it leaves the server.
            if (e.type === "final" || e.type === "draft") emit({ ...e, result: sanitizeAnalysis(e.result) });
            else emit(e);
          } },
        );
        setCachedAnalysis(cacheKey, JSON.stringify(sanitizeAnalysis(analysis))).catch((err) => {
          logger.warn("cache write failed", { reqId, err: err instanceof Error ? err.message : String(err) });
        });
        controller.close();
      } catch (err) {
        logger.error("analyze graph error", { reqId, err: err instanceof Error ? err.message : String(err) });
        // runAnalysis already emitted a typed error event.
        controller.close();
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return new Response(readable, { headers: streamHeaders });
```
Remove now-unused `MAX_RESPONSE_BYTES` if nothing else references it. Keep `UPSTREAM_TIMEOUT_MS`, `BODY_LIMIT_BYTES`, all six guards, and the `cacheKey` derivation (incl. refinement) unchanged.

- [ ] **Step 5 — verify:** `npx tsc --noEmit`.

- [ ] **Step 6 — update route tests** `app/api/analyze/route.test.ts`. Mock the graph instead of `ai`:
```ts
const mockRunAnalysis = vi.fn();
vi.mock("@/lib/agent/graph", () => ({ runAnalysis: (input: unknown, ctx: { emit: (e: unknown) => void }) => mockRunAnalysis(input, ctx) }));
```
Provide a helper that drives events + returns the result:
```ts
const VALID_OBJ = JSON.parse(VALID_RESULT);
function analysisOnce(result = VALID_OBJ) {
  mockRunAnalysis.mockImplementation(async (_input, ctx) => { ctx.emit({ type: "final", result }); return result; });
}
```
Update guard tests: they assert status codes only — unchanged, but ensure `mockRunAnalysis` is reset in `beforeEach` (`mockRunAnalysis.mockReset()`), and where the old tests asserted the model was/ wasn't called, assert on `mockRunAnalysis` instead. Update the happy-path/streaming/cache/sanitization/refinement tests to:
  - set `analysisOnce()` (or a custom result),
  - assert `response.headers.get("content-type")` contains `application/x-ndjson`,
  - read the body and assert it contains `'"type":"final"'` and the expected result fields,
  - for the cache test, assert `mockRunAnalysis` called once across two identical requests,
  - for the refinement test, assert the refinement reached `runAnalysis` via `mockRunAnalysis.mock.calls[0][0].refinement`.
Delete the byte-cap test and the `__ERROR__` raw-injection test (those defended the raw-text path, which no longer exists); replace the injection concern with one test asserting a thrown `runAnalysis` yields a body containing `'"type":"error"'`:
```ts
it("emits a typed error event when the agent throws", async () => {
  mockRunAnalysis.mockImplementation(async (_i, ctx) => { ctx.emit({ type: "error", message: "Analysis failed. Please try again." }); throw new Error("boom"); });
  const res = await POST(makeReq({}));
  const body = await collectStream(res);
  expect(body).toContain('"type":"error"');
});
```
- [ ] **Step 7 — run:** `npx vitest run app/api/analyze/route.test.ts` → PASS. Then `npm test` → PASS.
- [ ] **Step 8 — commit:** `feat(api): stream ndjson agent events from /api/analyze`

---

## Task 9: Client consumes events + AgentProgress  ← inline

**Files:** Create `components/AgentProgress.tsx`; Modify `components/GoldenCircleApp.tsx`

- [ ] **Step 1 — create** `components/AgentProgress.tsx`:
```tsx
'use client';

import { motion } from 'framer-motion';
import type { StepName } from '@/lib/agent/events';

export interface StepView { step: StepName; status: 'start' | 'finish'; }
interface Props { steps: StepView[]; score: number | null; }

const LABELS: Record<StepName, string> = {
  analyze: 'Drafting the analysis',
  critique: 'Critiquing the draft',
  refine: 'Refining weak points',
};

export default function AgentProgress({ steps, score }: Props) {
  return (
    <motion.div className="flex flex-col items-center gap-6 py-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {(Object.keys(LABELS) as StepName[]).map((s) => {
          const st = [...steps].reverse().find((x) => x.step === s);
          const state = !st ? 'idle' : st.status === 'finish' ? 'done' : 'active';
          return (
            <div key={s} className="flex items-center gap-3 text-sm">
              <span className={
                state === 'done' ? 'text-gold-400' : state === 'active' ? 'text-gold-300' : 'text-slate-500'
              }>
                {state === 'done' ? '✓' : state === 'active' ? '◐' : '○'}
              </span>
              <span className={state === 'idle' ? 'text-slate-500' : 'text-slate-200'}>{LABELS[s]}</span>
              {s === 'critique' && score !== null && (
                <span className="ml-auto text-gold-300">{score.toFixed(1)}/5</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
```
- [ ] **Step 2 — edit `GoldenCircleApp.tsx`.** Add imports:
```ts
import AgentProgress, { type StepView } from '@/components/AgentProgress';
import { parseEventLines, type AgentEvent } from '@/lib/agent/events';
```
Add state: `const [steps, setSteps] = useState<StepView[]>([]);` and `const [score, setScore] = useState<number | null>(null);`
In `handleSubmit`, reset them (`setSteps([]); setScore(null);`) before the fetch, and replace the raw-text reader block (the `while` loop + `__ERROR__` check + `parseAnalysis`) with:
```ts
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream.');
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: AnalysisResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseEventLines(buffer);
        buffer = rest;
        for (const event of events as AgentEvent[]) {
          if (event.type === 'step') setSteps((prev) => [...prev, { step: event.step, status: event.status }]);
          else if (event.type === 'critique') setScore(event.critique.overall);
          else if (event.type === 'final') finalResult = event.result as AnalysisResult;
          else if (event.type === 'error') throw new Error(event.message);
        }
      }
      if (!finalResult || !validateAnalysis(finalResult)) throw new Error('Received a malformed analysis. Please try again.');
      setResult(finalResult);
      setAppState('result');
      setHistory(saveAnalysis(trimmed, finalResult));
```
Add the import `import { validateAnalysis } from '@/lib/validate-analysis';` if not present. (Note: `validateAnalysis` is added in P0/earlier? It is NOT — the repo has `parseAnalysis`. Use `parseAnalysis` is for text. For an object, add a guard: `import { analysisSchema } from '@/lib/analysis-schema';` and use `analysisSchema.safeParse(finalResult).success`.) → Concretely: add `import { analysisSchema } from '@/lib/analysis-schema';` and change the guard to `if (!finalResult || !analysisSchema.safeParse(finalResult).success)`.
Replace `{appState === 'loading' && <LoadingState />}` with `{appState === 'loading' && <AgentProgress steps={steps} score={score} />}`. Remove the now-unused `LoadingState` import and the `parseAnalysis`/`sanitizeOutputString` imports if no longer referenced (check first).
- [ ] **Step 3 — verify:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run components/__tests__/InputForm.smoke.test.tsx`.
- [ ] **Step 4 — commit:** `feat(ui): consume ndjson agent events; show AgentProgress`

---

## Task 10: Verify  ← partial under disk constraint

- [ ] `npm run lint` → clean
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm test` → all green (report count)
- [ ] **DEFERRED (disk full):** `npm run build`, `docker compose up -d --build`, live browser smoke. Note these as deferred in the report; run once disk is freed.

---

## Self-Review

**Spec coverage (P1 = reflection loop + structured output + scores shown):** analyze/critique/refine nodes (T5), loop + events (T6), structured output via Zod (T1,T5), scores surfaced (T6 critique event → T9 UI). Plan-node trim documented.

**Placeholders:** none — every code step is complete.

**Type consistency:** `Analysis` (T1) used in events (T2), nodes (T5), graph (T6), route (T8), client (T9). `Critique` (T3) used in events/critique node/graph. `AgentContext.emit` (T5) constructed in route (T8) and tests (T6). `runAnalysis(input, ctx)` signature consistent T6/T8. Event `type` literals (`step|draft|critique|final|error`) identical across producer (graph) and consumers (route passthrough, client).

**Risk:** Task 8 (route) + Task 9 (client) are the protocol-breaking changes; they are last so the suite stays green through T1–T7. Cost: the loop adds a critique call always and one refine call when weak (≤3 LLM calls/request) — bounded by `MAX_REFINE=1`.
