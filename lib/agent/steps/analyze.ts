import { analysisSchema, type Analysis } from "@/lib/analysis-schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import { generateJson } from "@/lib/agent/generate-json";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// gpt-oss-120b is verbose and may spend tokens on reasoning; keep generous
// headroom so the JSON object is never truncated.
const MAX_OUTPUT_TOKENS = 4096;

// Produce a schema-valid draft analysis. Uses text completion + JSON extraction
// (not the provider's structured-output mode, unsupported by this model).
export async function analyzeStep(input: AgentInput, ctx: AgentContext): Promise<Analysis> {
  return generateJson({
    model: ctx.model,
    schema: analysisSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input.text, input.refinement),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    signal: ctx.signal,
  });
}
