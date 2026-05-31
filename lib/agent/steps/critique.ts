import { critiqueSchema, type Critique } from "@/lib/agent/critique-schema";
import type { Analysis } from "@/lib/analysis-schema";
import { CRITIQUE_SYSTEM_PROMPT, buildCritiquePrompt } from "@/lib/prompt";
import { generateJson } from "@/lib/agent/generate-json";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// Score the draft against the rubric. Drives the refine decision.
export async function critiqueStep(
  input: AgentInput,
  draft: Analysis,
  ctx: AgentContext,
): Promise<Critique> {
  return generateJson({
    model: ctx.model,
    schema: critiqueSchema,
    system: CRITIQUE_SYSTEM_PROMPT,
    prompt: buildCritiquePrompt(input.text, draft),
    maxOutputTokens: 1024,
    signal: ctx.signal,
  });
}
