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
