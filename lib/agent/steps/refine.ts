import { generateObject } from "ai";
import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { REFINE_SYSTEM_PROMPT, buildRefinePrompt } from "@/lib/prompt";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

const MAX_OUTPUT_TOKENS = 4096;

// Rewrite the draft to fix the critique's weaknesses, returning a fresh
// schema-valid analysis.
export async function refineStep(
  input: AgentInput,
  draft: Analysis,
  weaknesses: string[],
  ctx: AgentContext,
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
