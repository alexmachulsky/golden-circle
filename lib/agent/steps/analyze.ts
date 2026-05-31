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
