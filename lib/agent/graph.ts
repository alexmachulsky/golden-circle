import { analyzeStep } from "@/lib/agent/steps/analyze";
import { critiqueStep } from "@/lib/agent/steps/critique";
import { refineStep } from "@/lib/agent/steps/refine";
import type { Analysis } from "@/lib/analysis-schema";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// Bounded so free-tier cost stays predictable; the actual count is observable
// via the emitted step events (no silent cap).
const MAX_REFINE = 1;

// Reflection loop: analyze → critique → (refine if weak) → final. Emits typed
// step/draft/critique/final events and returns the best validated Analysis.
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

      ctx.emit({
        type: "step",
        step: "refine",
        status: "start",
        summary: `${critique.weaknesses.length} issue(s)`,
      });
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
