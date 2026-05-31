# P0 — Agent Foundations Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `/api/analyze` LLM call onto the Vercel AI SDK and behind a small typed agent **step-graph**, with **zero behavior change** — same text/plain streaming protocol, same client, same cache, same refinement feature, same `__ERROR__` injection defenses. This lays the foundation the P1 agentic loop builds on.

**Architecture:** Introduce `lib/agent/` (provider + typed input/context + a streaming `analyze` node + a `runAnalysisStream` graph runner). The route swaps its inline `new OpenAI(...)` + `chat.completions.create` for `runAnalysisStream(...)` but keeps its existing forward-loop, prompt-injection preamble scan, byte cap, cache, and headers verbatim. The node uses the AI SDK's `streamText` and yields raw text deltas, so nothing downstream changes.

**Tech Stack:** Next.js 16 (App Router, Node runtime), TypeScript, Vercel AI SDK (`ai` v5, `@ai-sdk/openai-compatible`), Vitest.

This is the first plan of the phased design in `docs/superpowers/specs/2026-05-31-eval-driven-agentic-strategy-engine-design.md`.

---

## Scope

**In P0 (behavior-preserving):**
- Add the AI SDK + an OpenRouter (`openai-compatible`) provider.
- A typed agent skeleton: `AgentInput`/`AgentContext`, a streaming `analyze` node, a `runAnalysisStream` runner.
- Rewire `/api/analyze` to source its text stream from the graph; keep everything else (guards, rate limit, body limit, Turnstile, cache via `computeCacheKey`, refinement, `__ERROR__` preamble scan, byte cap, `text/plain` headers).
- Update `route.test.ts` to mock the AI SDK (`ai.streamText`) instead of the `openai` client; all existing assertions (status codes, exact stream bodies, `__ERROR__`, cache, refinement, sanitization) stay.

**Deferred to P1 (explicitly NOT in P0):** the `analysisSchema` Zod source-of-truth + `citations`/`confidence`, the ndjson/SSE event protocol, the step-progress UI, structured output via `generateObject`, and any client (`GoldenCircleApp`) change. P0 keeps `parseAnalysis`/`sanitizeOutputString` and the client exactly as they are.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `ai`, `@ai-sdk/openai-compatible` |
| `lib/agent/state.ts` | Create | `AgentInput` (mode/text/refinement) + `AgentContext` (model, signal) |
| `lib/agent/llm.ts` | Create | `getModel(apiKey, modelId?)` → OpenRouter `LanguageModel` |
| `lib/agent/steps/analyze.ts` | Create | Streaming node: `streamText` → `AsyncGenerator<string>` of text deltas |
| `lib/agent/graph.ts` | Create | `runAnalysisStream(input, ctx)`: ordered node execution (one node in P0) |
| `lib/agent/graph.test.ts` | Create | Graph yields the node's deltas in order (analyze step mocked) |
| `app/api/analyze/route.ts` | Modify | Replace inline OpenAI client with `runAnalysisStream`; keep all else |
| `app/api/analyze/route.test.ts` | Modify | Mock `ai.streamText` instead of `openai`; keep all assertions |

Design rule (locked here): the `analyze` node is `(input, ctx) => AsyncGenerator<string>` and pulls the model from `ctx`, never importing a client directly. The runner owns ordering; in P1 it gains plan/critique/refine nodes and a structured return.

---

## Task 1: Add AI SDK dependencies

**Files:** Modify `package.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install ai@^5 @ai-sdk/openai-compatible@^1
```
Expected: `dependencies` now include `ai` and `@ai-sdk/openai-compatible`; lockfile updated.

- [ ] **Step 2: Type-check + build still pass**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add Vercel AI SDK + openai-compatible provider"
```

---

## Task 2: Agent input/context types + OpenRouter provider

**Files:** Create `lib/agent/state.ts`, `lib/agent/llm.ts`

- [ ] **Step 1: Create `lib/agent/state.ts`**

```ts
import type { LanguageModel } from "ai";
import type { RefinementKey } from "@/lib/prompt";

// What the user asked for. P0 supports only free-text "idea" mode; `mode` is
// declared now so company mode (P2) slots in without a signature change.
// `refinement` mirrors the existing allowlisted refine feature.
export interface AgentInput {
  mode: "idea";
  text: string;
  refinement: RefinementKey | null;
}

// Injected dependencies. Nodes receive this instead of importing a client, so
// they stay unit-testable.
export interface AgentContext {
  model: LanguageModel;
  signal: AbortSignal;
}
```

- [ ] **Step 2: Create `lib/agent/llm.ts`**

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { ALLOWED_ORIGINS } from "@/lib/config";

// Same model and OpenRouter attribution headers as the pre-AI-SDK route.
// `:free` variant — drop the suffix for the paid variant.
export const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

// The key is read at call time (never cached at import) so Docker-secret
// rotation keeps working.
export function getModel(apiKey: string, modelId: string = DEFAULT_MODEL): LanguageModel {
  const provider = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": ALLOWED_ORIGINS[0] ?? "http://localhost:7001",
      "X-Title": "Golden Circle Analyzer",
    },
  });
  return provider(modelId);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/state.ts lib/agent/llm.ts
git commit -m "feat(agent): add agent input/context types and OpenRouter provider"
```

---

## Task 3: The streaming `analyze` node

**Files:** Create `lib/agent/steps/analyze.ts`

(Covered by the graph test in Task 4 with a mocked `ai.streamText`; the route tests in Task 5 exercise it end-to-end.)

- [ ] **Step 1: Create `lib/agent/steps/analyze.ts`**

```ts
import { streamText } from "ai";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// gpt-oss-120b is verbose and may spend tokens on reasoning; keep the generous
// headroom the previous direct call used so JSON is never truncated.
const MAX_OUTPUT_TOKENS = 4096;

// P0 node: stream the analysis as raw text deltas, exactly as the previous
// direct OpenRouter call did, so the route's forward-loop / injection scan /
// byte cap / cache logic is unchanged. Structured output and additional nodes
// arrive in P1.
export async function* analyzeStep(
  input: AgentInput,
  ctx: AgentContext,
): AsyncGenerator<string> {
  const result = streamText({
    model: ctx.model,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input.text, input.refinement),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: ctx.signal,
  });
  for await (const delta of result.textStream) {
    yield delta;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/steps/analyze.ts
git commit -m "feat(agent): add streaming analyze node using AI SDK streamText"
```

---

## Task 4: Graph runner

**Files:** Create `lib/agent/graph.ts`, `lib/agent/graph.test.ts`

- [ ] **Step 1: Write the failing test — `lib/agent/graph.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";

// Replace the analyze node so the graph test never touches the network.
vi.mock("@/lib/agent/steps/analyze", () => ({
  analyzeStep: async function* () {
    yield "Hello ";
    yield "world";
  },
}));

import { runAnalysisStream } from "@/lib/agent/graph";
import type { AgentContext } from "@/lib/agent/state";

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

describe("runAnalysisStream", () => {
  it("yields the analyze node's deltas in order", async () => {
    const ctx = { model: {} as never, signal: new AbortController().signal } as AgentContext;
    const text = await collect(runAnalysisStream({ mode: "idea", text: "x", refinement: null }, ctx));
    expect(text).toBe("Hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/agent/graph.test.ts`
Expected: FAIL — cannot resolve `@/lib/agent/graph`.

- [ ] **Step 3: Create `lib/agent/graph.ts`**

```ts
import { analyzeStep } from "@/lib/agent/steps/analyze";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// Ordered execution of agent steps, yielding text deltas. P0 has a single
// streaming node; P1 inserts plan/critique/refine here and switches the return
// to a structured result + typed events.
export async function* runAnalysisStream(
  input: AgentInput,
  ctx: AgentContext,
): AsyncGenerator<string> {
  yield* analyzeStep(input, ctx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/agent/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/graph.ts lib/agent/graph.test.ts
git commit -m "feat(agent): add runAnalysisStream graph runner"
```

---

## Task 5: Wire the route to the graph (no protocol change)

**Files:** Modify `app/api/analyze/route.ts`, `app/api/analyze/route.test.ts`

- [ ] **Step 1: Edit `app/api/analyze/route.ts`**

(a) Change the prompt import — the route no longer builds prompts (the node does), but still needs the refinement allowlist:
```ts
// before:
import { SYSTEM_PROMPT, buildUserPrompt, REFINEMENTS, type RefinementKey } from "@/lib/prompt";
// after:
import { REFINEMENTS, type RefinementKey } from "@/lib/prompt";
```

(b) Remove `import OpenAI from "openai";`. Add:
```ts
import { getModel } from "@/lib/agent/llm";
import { runAnalysisStream } from "@/lib/agent/graph";
```

(c) Remove the now-unused constants `MODEL` and `OPENROUTER_BASE_URL`. Keep `UPSTREAM_TIMEOUT_MS`, `MAX_RESPONSE_BYTES`, `BODY_LIMIT_BYTES`.

(d) Inside the `ReadableStream.start`, delete the OpenAI client construction (the `const client = new OpenAI({ ... });` block, ~lines 202–210) and replace the `const stream = await client.chat.completions.create({ ...messages... }, { signal: ac.signal });` call with:
```ts
        const model = getModel(apiKey);
        const stream = runAnalysisStream(
          { mode: "idea", text: sanitized, refinement },
          { model, signal: ac.signal },
        );
```

(e) Change the forward-loop header from iterating SDK chunks to iterating text deltas. Replace:
```ts
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
```
with:
```ts
        for await (const text of stream) {
          if (text) {
```
Leave the entire loop **body** (the `checkedPrefix` injection scan, `accumulated`/`fullResponse` handling, the `MAX_RESPONSE_BYTES` cap, the trailing-buffer flush after the loop, `controller.close()`, and the `setCachedAnalysis(cacheKey, fullResponse)` write) exactly as-is. The `catch`/`finally` (timeout detection → `__ERROR__` sentinel, `clearTimeout`) stays unchanged — `streamText` surfaces an abort by rejecting the `textStream` iteration, which this `catch` already handles.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`openai` may now be unused as a dependency — leave it in `package.json`; removing it is a separate cleanup.)

- [ ] **Step 3: Update `app/api/analyze/route.test.ts` mocks**

The route now calls `ai.streamText` (via the node) instead of the `openai` client. The protocol/bodies are unchanged, so only the mock layer changes.

(a) Replace the `openai` mock and the shared `mockCreate` with a `streamText` mock:
```ts
// remove: const mockCreate = vi.fn();
// remove the whole vi.mock('openai', () => ({ ... })) block

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (opts: unknown) => mockStreamText(opts),
}));
```

(b) Replace the `streamOnce` helper and the inline generators so they return `{ textStream }` yielding **strings** (not `{ choices: [{ delta: { content } }] }`):
```ts
function streamOnce(text: string) {
  mockStreamText.mockReturnValue({
    textStream: (async function* () { yield text; })(),
  });
}
```
For every inline `mockCreate.mockResolvedValue((async function*(){ yield { choices:[{delta:{content: X}}] }; })())`, rewrite as:
```ts
mockStreamText.mockReturnValue({
  textStream: (async function* () { yield X; })(),
});
```
For the multi-chunk happy-path/turnstile tests, yield each chunk string in sequence inside one `textStream` generator.

(c) Update `userPromptOf` to read the AI SDK call shape:
```ts
function userPromptOf(call: number = 0): string {
  return String(mockStreamText.mock.calls[call]?.[0]?.prompt ?? "");
}
```
(The user prompt is now `opts.prompt`; the system prompt is `opts.system`.)

(d) Update the two error-path tests to fail **inside** the stream (AI SDK surfaces errors during iteration, not at call time):
```ts
// "streams generic __ERROR__ message ... on upstream failure"
mockStreamText.mockReturnValue({
  textStream: (async function* () { throw new Error("Internal provider error 500 secret details"); })(),
});
// "reports a timeout when the SDK aborts"
mockStreamText.mockReturnValue({
  textStream: (async function* () {
    throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
  })(),
});
```

(e) In `beforeEach`, replace `mockCreate.mockReset();` with `mockStreamText.mockReset();`. Replace every remaining `mockCreate` reference (e.g. `expect(mockCreate).toHaveBeenCalledTimes(...)`, `expect(mockCreate).not.toHaveBeenCalled()`) with `mockStreamText`.

- [ ] **Step 4: Run the route tests**

Run: `npx vitest run app/api/analyze/route.test.ts`
Expected: PASS — all guard, happy-path, streaming-edge, sanitization, refinement, and cache tests green with the new mock.

- [ ] **Step 5: Full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/analyze/route.ts app/api/analyze/route.test.ts
git commit -m "feat(api): route /api/analyze through the agent graph (AI SDK)"
```

---

## Task 6: Verify (lint, types, build, docker, smoke)

**Files:** none (verification only)

- [ ] **Step 1: Lint + types + tests**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all PASS.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke (real key)**

Run: `npm run dev`, submit a business idea at http://localhost:7001.
Expected: a full analysis (1 WHY / 4 HOW / 3 WHAT / positioning note) renders and streams as before. Submitting the same idea again is served from cache (server log `cache: "hit"`). The refine buttons (when Turnstile is disabled) still work.

- [ ] **Step 4: Rebuild the container (repo convention)**

Run: `docker compose up -d --build`
Expected: builds and serves on `127.0.0.1:7001`.

- [ ] **Step 5: Commit any verification fixes**

```bash
git add -A && git commit -m "chore(p0): verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (P0 intent = AI SDK adoption + step-graph skeleton, output parity):**
- AI SDK adopted → Tasks 1, 2, 3 (`streamText`).
- Step-graph skeleton → Tasks 2–4 (`AgentInput`/`AgentContext`/node/runner).
- `/api/analyze` routed through the graph with no behavior change → Task 5.
- Output parity (protocol, client, cache, refinement, `__ERROR__`, byte cap preserved) → Task 5 keeps the loop body/catch verbatim; client untouched.

**Deliberate deferrals (logged, not gaps):** `analysisSchema` + citations/confidence, ndjson/SSE events, step UI, and `generateObject` structured output move to **P1**, where the multi-step agent makes them meaningful. P0 is intentionally behavior-preserving to de-risk the SDK migration and avoid churning the ~30 existing route tests' assertions.

**Placeholder scan:** none — every code/test step shows complete code and the exact command + expected result.

**Type consistency:** `AgentInput { mode, text, refinement }` and `AgentContext { model, signal }` (Task 2) are used identically in the node (Task 3), runner (Task 4), and route (Task 5). `getModel(apiKey)` (Task 2) matches its call in Task 5. `runAnalysisStream(input, ctx)` matches between Task 4 (def/test) and Task 5 (call). The node/runner both return `AsyncGenerator<string>`, which the route consumes with `for await (const text of stream)`.
