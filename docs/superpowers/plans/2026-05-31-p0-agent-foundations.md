# P0 — Agent Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single raw-text OpenRouter call behind `/api/analyze` with a typed, single-node agent step-graph that produces schema-validated structured output and streams typed step events (SSE) to the client — with output parity to today.

**Architecture:** Introduce a small typed step-graph (`lib/agent/`) whose nodes are pure functions over an injected context (`ctx`). P0 ships exactly one node (`analyze`) built on the Vercel AI SDK's `streamObject` + a Zod schema, so JSON correctness moves server-side and the brittle client-side `extractJson`/`JSON.parse` path is retired. The route emits a typed SSE event stream (`step`, `draft`, `final`, `error`); the client consumes events instead of accumulating raw text. All existing guards, rate limiting, caching, sanitization, and the `__ERROR__` contract are preserved.

**Tech Stack:** Next.js 16 (App Router, Node runtime), TypeScript, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`), Zod 4, Vitest.

This is the first plan of the phased design in `docs/superpowers/specs/2026-05-31-eval-driven-agentic-strategy-engine-design.md`. P1 (plan→analyze→critique→refine loop) is a separate, follow-up plan that builds on the graph created here.

---

## Scope

**In P0:**
- Add AI SDK deps and an OpenRouter provider module.
- A Zod schema that is the single source of truth for `AnalysisResult` (server validation + AI SDK structured output), with optional `citations`/`confidence` fields added now (unused until P2) so the wire shape is stable.
- A typed step-graph runner + `AgentState` + one `analyze` node using `streamObject`.
- A typed SSE event protocol (`lib/agent/events.ts`) shared by server and client.
- `/api/analyze` rewritten to run the graph and stream events; guards/cache/sanitization unchanged.
- Client (`GoldenCircleApp`) rewritten to consume SSE events; delete `extractJson`.
- Cache stores the final validated JSON string; `__ERROR__` contract preserved inside the `error` event.

**Out of P0 (later phases):** research/RAG nodes, critique/refine loop, company mode, Langfuse/OTel, Postgres, evals.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `ai`, `@ai-sdk/openai-compatible` deps |
| `lib/analysis-schema.ts` | Create | Zod `analysisSchema` + inferred type; single source of truth for the analysis shape |
| `lib/agent/events.ts` | Create | `AgentEvent` discriminated union + `encodeEvent`/`parseEvent` (SSE line framing) |
| `lib/agent/state.ts` | Create | `AgentState`, `AgentContext` (injected deps), `AgentInput` types |
| `lib/agent/llm.ts` | Create | OpenRouter provider factory (`getModel`) via `@ai-sdk/openai-compatible` |
| `lib/agent/steps/analyze.ts` | Create | The single P0 node: `streamObject` → emits `draft`/`final` events, returns analysis |
| `lib/agent/graph.ts` | Create | `runGraph(input, ctx, emit)`: runs nodes in order, emits step events, error handling |
| `lib/validate-analysis.ts` | Modify | Reimplement `validateAnalysis` on top of `analysisSchema` (keep signature) |
| `app/api/analyze/route.ts` | Modify | Build `ctx`, stream `runGraph` events as SSE; keep guards/cache |
| `components/GoldenCircleApp.tsx` | Modify | Consume SSE events; remove `extractJson`/raw-text assembly |
| `lib/agent/events.test.ts` | Create | Round-trip + framing tests for the event codec |
| `lib/analysis-schema.test.ts` | Create | Schema accept/reject tests (4 HOW / 3 WHAT etc.) |
| `lib/agent/graph.test.ts` | Create | Graph runs the analyze node with a mocked `ctx`, emits ordered events |

Design rule (locked here): every step node is `(state: AgentState, ctx: AgentContext) => Promise<Partial<AgentState>>` and may call `ctx.emit(event)`; the runner owns ordering/error handling. Nodes never import the model client directly — they use `ctx.model`.

---

## Task 1: Add AI SDK dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the AI SDK + OpenAI-compatible provider**

Run:
```bash
npm install ai@^5 @ai-sdk/openai-compatible@^1
```
Expected: `package.json` `dependencies` now include `ai` and `@ai-sdk/openai-compatible`; `package-lock.json` updated. (`zod` is already a dependency.)

- [ ] **Step 2: Verify the project still type-checks and builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add Vercel AI SDK and openai-compatible provider"
```

---

## Task 2: Analysis Zod schema (single source of truth)

**Files:**
- Create: `lib/analysis-schema.ts`
- Test: `lib/analysis-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/analysis-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analysisSchema } from "@/lib/analysis-schema";

const validHow = { title: "t", description: "d", uniqueness: "u" };
const validWhat = { title: "t", description: "d", why_connection: "w" };

function validAnalysis() {
  return {
    why: { statement: "s", depth_note: "n" },
    how: [validHow, validHow, validHow, validHow],
    what: [validWhat, validWhat, validWhat],
    positioning_note: "p",
  };
}

describe("analysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(analysisSchema.safeParse(validAnalysis()).success).toBe(true);
  });

  it("rejects when how has the wrong length", () => {
    const bad = { ...validAnalysis(), how: [validHow, validHow, validHow] };
    expect(analysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects when what has the wrong length", () => {
    const bad = { ...validAnalysis(), what: [validWhat, validWhat] };
    expect(analysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing positioning_note", () => {
    const bad = validAnalysis() as Record<string, unknown>;
    delete bad.positioning_note;
    expect(analysisSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts optional citations and confidence when present", () => {
    const withExtras = {
      ...validAnalysis(),
      citations: [{ claim: "c", source: "Acme 10-K", url: "https://example.com" }],
      confidence: { why: 0.9, how: 0.8, what: 0.7 },
    };
    expect(analysisSchema.safeParse(withExtras).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/analysis-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/analysis-schema`.

- [ ] **Step 3: Write the schema**

Create `lib/analysis-schema.ts`:
```ts
import { z } from "zod";

// Single source of truth for the analysis shape. Used for (a) AI SDK structured
// output, (b) server-side validation, (c) the inferred TS type. The exactly-4-HOW
// / exactly-3-WHAT invariant lives here so it cannot drift across layers.
//
// `citations` and `confidence` are optional and unused until P2 (grounding/RAG);
// they are declared now so the wire shape is stable across phases.

export const citationSchema = z.object({
  claim: z.string(),
  source: z.string(),
  url: z.string().url().optional(),
});

export const analysisSchema = z.object({
  why: z.object({
    statement: z.string(),
    depth_note: z.string(),
  }),
  how: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        uniqueness: z.string(),
      }),
    )
    .length(4),
  what: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        why_connection: z.string(),
      }),
    )
    .length(3),
  positioning_note: z.string(),
  citations: z.array(citationSchema).optional(),
  confidence: z
    .object({ why: z.number(), how: z.number(), what: z.number() })
    .optional(),
});

export type Analysis = z.infer<typeof analysisSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/analysis-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis-schema.ts lib/analysis-schema.test.ts
git commit -m "feat(agent): add zod analysis schema as single source of truth"
```

---

## Task 3: Reimplement validateAnalysis on the schema (keep signature)

**Files:**
- Modify: `lib/validate-analysis.ts`
- Test: `lib/validate-analysis.test.ts` (exists — keep it green)

- [ ] **Step 1: Run the existing tests to capture the current behavior**

Run: `npx vitest run lib/validate-analysis.test.ts`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Replace the hand-written guard with a schema-backed one**

Replace the entire body of `lib/validate-analysis.ts` with:
```ts
import type { AnalysisResult } from "@/types";
import { analysisSchema } from "@/lib/analysis-schema";

// Runtime validation of the analysis shape. Backed by `analysisSchema` so the
// 4-HOW / 3-WHAT invariant has exactly one definition. Signature is unchanged
// (a type guard) so existing callers keep working.
export function validateAnalysis(value: unknown): value is AnalysisResult {
  return analysisSchema.safeParse(value).success;
}
```

- [ ] **Step 3: Run the existing tests to verify they still pass**

Run: `npx vitest run lib/validate-analysis.test.ts`
Expected: PASS — same behavior, now schema-backed. If any test asserted rejection of extra unknown keys, it still passes because Zod objects strip unknown keys by default (they do not fail). If a test specifically required *stripping*, note it; no change expected for the existing shape tests.

- [ ] **Step 4: Commit**

```bash
git add lib/validate-analysis.ts
git commit -m "refactor(validate): back validateAnalysis with analysisSchema"
```

---

## Task 4: Agent event protocol (codec)

**Files:**
- Create: `lib/agent/events.ts`
- Test: `lib/agent/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/agent/events.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeEvent, parseEventLines, type AgentEvent } from "@/lib/agent/events";

describe("agent event codec", () => {
  it("encodes an event as a single newline-terminated JSON line", () => {
    const evt: AgentEvent = { type: "step", step: "analyze", status: "start" };
    const encoded = encodeEvent(evt);
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("round-trips events through encode + parse", () => {
    const events: AgentEvent[] = [
      { type: "step", step: "analyze", status: "start" },
      { type: "final", result: { positioning_note: "p" } as never },
      { type: "error", message: "boom" },
    ];
    const buffer = events.map(encodeEvent).join("");
    const { events: parsed, rest } = parseEventLines(buffer);
    expect(parsed).toEqual(events);
    expect(rest).toBe("");
  });

  it("keeps a trailing partial line in `rest` for the next chunk", () => {
    const full = encodeEvent({ type: "step", step: "analyze", status: "finish" });
    const buffer = full + '{"type":"err';
    const { events: parsed, rest } = parseEventLines(buffer);
    expect(parsed).toHaveLength(1);
    expect(rest).toBe('{"type":"err');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/agent/events.test.ts`
Expected: FAIL — cannot resolve `@/lib/agent/events`.

- [ ] **Step 3: Write the codec**

Create `lib/agent/events.ts`:
```ts
import type { Analysis } from "@/lib/analysis-schema";

// Newline-delimited JSON event protocol streamed from /api/analyze. One JSON
// object per line keeps client parsing trivial and survives chunk boundaries.
export type StepName = "analyze";

export type AgentEvent =
  | { type: "step"; step: StepName; status: "start" | "finish"; summary?: string }
  | { type: "draft"; partial: unknown }
  | { type: "final"; result: Analysis }
  | { type: "error"; message: string };

export function encodeEvent(event: AgentEvent): string {
  return JSON.stringify(event) + "\n";
}

// Parses as many complete lines as possible from `buffer`. Returns the parsed
// events and any trailing partial line (`rest`) to prepend to the next chunk.
export function parseEventLines(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      // Skip an unparseable line rather than aborting the whole stream.
    }
  }
  return { events, rest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/agent/events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/events.ts lib/agent/events.test.ts
git commit -m "feat(agent): add newline-delimited agent event protocol"
```

---

## Task 5: Agent state + context types

**Files:**
- Create: `lib/agent/state.ts`

- [ ] **Step 1: Write the types (no test — type-only module, covered by graph tests)**

Create `lib/agent/state.ts`:
```ts
import type { LanguageModel } from "ai";
import type { Analysis } from "@/lib/analysis-schema";
import type { AgentEvent } from "@/lib/agent/events";

// What the user asked for. P0 only supports free-text idea mode; `mode` is
// declared now so company mode (P2) slots in without a signature change.
export interface AgentInput {
  mode: "idea";
  text: string;
}

// Injected dependencies. Nodes receive this instead of importing clients
// directly, so they are unit-testable with fakes.
export interface AgentContext {
  model: LanguageModel;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

// Threaded through the graph; nodes return Partial<AgentState> to merge in.
export interface AgentState {
  input: AgentInput;
  analysis?: Analysis;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/state.ts
git commit -m "feat(agent): add AgentInput/Context/State types"
```

---

## Task 6: OpenRouter model provider

**Files:**
- Create: `lib/agent/llm.ts`

- [ ] **Step 1: Write the provider (no unit test — thin factory; exercised via route + manual run)**

Create `lib/agent/llm.ts`:
```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

// Default model — same one used before the AI SDK migration.
export const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

// Build a LanguageModel bound to OpenRouter. The key is read at call time
// (never cached at module load) so Docker-secret rotation works.
export function getModel(apiKey: string, modelId: string = DEFAULT_MODEL): LanguageModel {
  const provider = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return provider(modelId);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/llm.ts
git commit -m "feat(agent): add OpenRouter model provider via openai-compatible"
```

---

## Task 7: The `analyze` step node

**Files:**
- Create: `lib/agent/steps/analyze.ts`

- [ ] **Step 1: Write the node (covered by the graph test in Task 8 with a mocked model)**

Create `lib/agent/steps/analyze.ts`:
```ts
import { streamObject } from "ai";
import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import type { AgentContext, AgentState } from "@/lib/agent/state";

// P0's single node: produce a schema-valid analysis via streamObject. Emits a
// `draft` event per partial object (progressive UI) and returns the validated
// final object. The runner emits the surrounding step start/finish events.
export async function analyzeStep(
  state: AgentState,
  ctx: AgentContext,
): Promise<Partial<AgentState>> {
  const result = streamObject({
    model: ctx.model,
    schema: analysisSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(state.input.text),
    abortSignal: ctx.signal,
  });

  for await (const partial of result.partialObjectStream) {
    ctx.emit({ type: "draft", partial });
  }

  const analysis = (await result.object) as Analysis; // throws if schema-invalid
  return { analysis };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/steps/analyze.ts
git commit -m "feat(agent): add analyze step using streamObject"
```

---

## Task 8: Graph runner

**Files:**
- Create: `lib/agent/graph.ts`
- Test: `lib/agent/graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/agent/graph.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runGraph } from "@/lib/agent/graph";
import type { AgentEvent } from "@/lib/agent/events";
import type { AgentContext } from "@/lib/agent/state";

const validResult = {
  why: { statement: "s", depth_note: "n" },
  how: Array.from({ length: 4 }, () => ({ title: "t", description: "d", uniqueness: "u" })),
  what: Array.from({ length: 3 }, () => ({ title: "t", description: "d", why_connection: "w" })),
  positioning_note: "p",
};

// Replace the analyze step with a fake so the graph test never hits the network.
vi.mock("@/lib/agent/steps/analyze", () => ({
  analyzeStep: vi.fn(async (_state, ctx) => {
    ctx.emit({ type: "draft", partial: { why: { statement: "s" } } });
    return { analysis: validResult };
  }),
}));

function makeCtx(events: AgentEvent[]): AgentContext {
  return {
    model: {} as never,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  };
}

describe("runGraph", () => {
  it("emits step start/finish around analyze and a final event", async () => {
    const events: AgentEvent[] = [];
    const ctx = makeCtx(events);
    const result = await runGraph({ mode: "idea", text: "an idea" }, ctx);

    expect(result).toEqual(validResult);
    const types = events.map((e) => e.type);
    expect(types).toEqual(["step", "draft", "step", "final"]);
    expect(events[0]).toMatchObject({ type: "step", step: "analyze", status: "start" });
    expect(events[2]).toMatchObject({ type: "step", step: "analyze", status: "finish" });
    expect(events[3]).toMatchObject({ type: "final", result: validResult });
  });

  it("emits an error event and rethrows when a step throws", async () => {
    const mod = await import("@/lib/agent/steps/analyze");
    vi.mocked(mod.analyzeStep).mockRejectedValueOnce(new Error("model down"));
    const events: AgentEvent[] = [];
    const ctx = makeCtx(events);

    await expect(runGraph({ mode: "idea", text: "x" }, ctx)).rejects.toThrow("model down");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/agent/graph.test.ts`
Expected: FAIL — cannot resolve `@/lib/agent/graph`.

- [ ] **Step 3: Write the runner**

Create `lib/agent/graph.ts`:
```ts
import { analyzeStep } from "@/lib/agent/steps/analyze";
import type { Analysis } from "@/lib/analysis-schema";
import type { AgentContext, AgentInput, AgentState } from "@/lib/agent/state";

// Runs the ordered list of nodes, emitting step start/finish around each. P0 has
// a single node; P1 inserts plan/critique/refine here. The runner owns control
// flow and error surfacing so nodes stay simple and pure.
export async function runGraph(input: AgentInput, ctx: AgentContext): Promise<Analysis> {
  let state: AgentState = { input };
  try {
    ctx.emit({ type: "step", step: "analyze", status: "start" });
    state = { ...state, ...(await analyzeStep(state, ctx)) };
    ctx.emit({ type: "step", step: "analyze", status: "finish" });

    if (!state.analysis) {
      throw new Error("analyze step produced no analysis");
    }
    ctx.emit({ type: "final", result: state.analysis });
    return state.analysis;
  } catch (err) {
    ctx.emit({
      type: "error",
      message: "Analysis failed. Please try again.",
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/agent/graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/graph.ts lib/agent/graph.test.ts
git commit -m "feat(agent): add graph runner emitting step events"
```

---

## Task 9: Wire the route to the graph (SSE)

**Files:**
- Modify: `app/api/analyze/route.ts`

- [ ] **Step 1: Replace the OpenAI streaming block with the graph + event stream**

In `app/api/analyze/route.ts`:

(a) Remove the `import OpenAI from "openai";` line and the `import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";` line (the prompt is now used inside the analyze node, not the route).

(b) Add these imports near the other `@/lib` imports:
```ts
import { runGraph } from "@/lib/agent/graph";
import { getModel } from "@/lib/agent/llm";
import { encodeEvent, type AgentEvent } from "@/lib/agent/events";
```

(c) Remove the now-unused constants `MODEL` and `MAX_TOKENS` (the model id lives in `lib/agent/llm.ts`; token caps are handled by the SDK). Keep `REQUEST_TIMEOUT_MS`.

(d) Replace the entire block from `const openai = new OpenAI({ ... })` through the `return new Response(readable, { ... })` (the OpenRouter call, the `ReadableStream`, and its response) with:
```ts
    const model = getModel(apiKey);
    const encoder = new TextEncoder();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: AgentEvent) => {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        };
        try {
          const analysis = await runGraph(
            { mode: "idea", text: sanitizedInput },
            { model, emit, signal: timeout },
          );
          // Cache only the final validated JSON (never partials/errors).
          setCachedAnalysis(sanitizedInput, JSON.stringify(analysis));
          controller.close();
        } catch (err) {
          // runGraph already emitted a typed `error` event for the client.
          logger.error("analyze.graph_error", {
            requestId,
            error: err instanceof Error ? err.message : "unknown",
          });
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
```

(e) Update the cache-hit branch (currently returns `cached` as `text/plain`). The cached value is now a JSON string of the analysis; wrap it as a `final` event so the client's event consumer handles hits and misses identically:
```ts
    const cached = getCachedAnalysis(sanitizedInput);
    if (cached) {
      logger.info("analyze.cache_hit", { requestId });
      const event = encodeEvent({ type: "final", result: JSON.parse(cached) });
      return new Response(event, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      });
    }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `openai` is now unused anywhere else, that's expected — leave the dependency in `package.json` for now (removing it is a separate cleanup).

- [ ] **Step 3: Run the route tests**

Run: `npx vitest run app/api/analyze/route.test.ts`
Expected: Some assertions about the old `text/plain` body or the `openai` mock will fail. Update those tests: mock `@/lib/agent/graph`'s `runGraph` instead of the `openai` client, assert the response `Content-Type` is `application/x-ndjson`, and assert the streamed body contains a `final` event line. Concretely, add near the other `vi.mock` calls:
```ts
vi.mock("@/lib/agent/graph", () => ({
  runGraph: vi.fn(async (_input, ctx) => {
    const result = {
      why: { statement: "s", depth_note: "n" },
      how: Array.from({ length: 4 }, () => ({ title: "t", description: "d", uniqueness: "u" })),
      what: Array.from({ length: 3 }, () => ({ title: "t", description: "d", why_connection: "w" })),
      positioning_note: "p",
    };
    ctx.emit({ type: "final", result });
    return result;
  }),
}));
```
and in the success-path test, read the response body text and assert:
```ts
const body = await response.text();
expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
expect(body).toContain('"type":"final"');
```
Keep all guard/rate-limit/validation tests unchanged.

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/analyze/route.ts app/api/analyze/route.test.ts
git commit -m "feat(api): stream agent events (ndjson) from /api/analyze"
```

---

## Task 10: Client consumes the event stream

**Files:**
- Modify: `components/GoldenCircleApp.tsx`

- [ ] **Step 1: Replace raw-text assembly with event consumption**

In `components/GoldenCircleApp.tsx`:

(a) Add the import:
```ts
import { parseEventLines, type AgentEvent } from '@/lib/agent/events';
```

(b) Replace the body of the `try` block in `handleSubmit` from `const reader = response.body?.getReader();` through `setState('result');` (the raw-text accumulation, `extractJson`, `JSON.parse`, `validateAnalysis`) with:
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
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'final') finalResult = event.result as AnalysisResult;
        }
      }

      if (!finalResult || !validateAnalysis(finalResult)) {
        throw new Error('Received malformed analysis. Please try again.');
      }

      setResult(finalResult);
      setState('result');
      const updated = saveAnalysis(idea, finalResult);
      setHistory(updated);
```

(c) Delete the local `extractJson` helper from this file (it is no longer referenced). Keep `validateAnalysis` (import it from `@/lib/validate-analysis` if it was a local helper; if it is already imported, leave it).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `extractJson` was referenced elsewhere, the compiler will flag it — remove those references.

- [ ] **Step 3: Run component smoke tests**

Run: `npx vitest run components/__tests__/InputForm.smoke.test.tsx`
Expected: PASS (no change in behavior these tests cover).

- [ ] **Step 4: Lint + full check**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add components/GoldenCircleApp.tsx
git commit -m "feat(ui): consume ndjson agent events; drop client JSON extraction"
```

---

## Task 11: Manual verification + build + Docker

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds; no type or lint errors.

- [ ] **Step 2: Run the app and exercise the happy path**

Run: `npm run dev` then submit a business idea in the browser at http://localhost:7001.
Expected: a complete analysis renders (1 WHY / 4 HOW / 3 WHAT / positioning note), identical in shape to before. Network tab shows `/api/analyze` responding `application/x-ndjson` with `step`, `draft`, and `final` lines.

- [ ] **Step 3: Verify cache hit path**

Submit the exact same idea again.
Expected: result renders; server log shows `analyze.cache_hit`; response is a single `final` line.

- [ ] **Step 4: Rebuild the container (per repo convention)**

Run: `docker compose up -d --build`
Expected: container builds and serves on `127.0.0.1:7001`.

- [ ] **Step 5: Commit any fixes discovered during verification, then tag the phase**

```bash
git add -A
git commit -m "chore(p0): verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (P0 rows of the design):**
- AI SDK migration → Tasks 1, 6, 7.
- Extended schema (citations/confidence) → Task 2 (optional fields declared).
- `/api/analyze` → SSE step events → Tasks 4, 9.
- UI renders steps / consumes events → Task 10. (Rich per-step UI panel `AgentProgress.tsx` is deferred to P1, when there are multiple steps worth visualizing; P0 consumes events and keeps the existing `LoadingState`. This is an intentional, logged scope choice — P0's single node has nothing multi-step to show yet.)
- Structured output replaces client JSON extraction → Tasks 2, 7, 10.
- Cache stores final validated JSON; `__ERROR__`/error contract preserved → Tasks 4, 9 (errors flow via the typed `error` event).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the test and the expected run output.

**Type consistency:** `analysisSchema`/`Analysis` (Task 2) are used identically in Tasks 3, 7, 8, 9. `AgentEvent` (Task 4) is used in 8/9/10. `AgentContext` fields `model`/`emit`/`signal` (Task 5) match their construction in the route (Task 9) and the graph test (Task 8). `runGraph(input, ctx)` signature matches between Task 8 (def/test) and Task 9 (call). `getModel(apiKey)` (Task 6) matches its call in Task 9.

**Note on `AnalysisResult` vs `Analysis`:** `types/index.ts` keeps the canonical `AnalysisResult` interface for the UI; `Analysis` (z.infer) is structurally compatible (same required fields). Casts at the boundaries (Tasks 9/10) are intentional and safe because both share the validated shape. A later cleanup may unify them, but unifying is out of P0 scope to keep this plan focused.
