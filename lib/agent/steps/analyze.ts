import { generateObject } from "ai";
import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// gpt-oss-120b is verbose and may spend tokens on reasoning; keep generous
// headroom so the structured object is never truncated.
const MAX_OUTPUT_TOKENS = 4096;

// Produce a schema-valid draft analysis via structured output (no text parsing).
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
