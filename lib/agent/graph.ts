import { analyzeStep } from "@/lib/agent/steps/analyze";
import { critiqueStep } from "@/lib/agent/steps/critique";
import { refineStep } from "@/lib/agent/steps/refine";
import type { Analysis } from "@/lib/analysis-schema";
import type { AgentContext, AgentInput } from "@/lib/agent/state";

// Bounded so free-tier cost stays predictable; the actual count is observable
// via the emitted step events (no silent cap).
const MAX_REFINE = 1;

// Reflection loop: analyze → critique → (refine if weak) → final.
//
// The draft from `analyze` is already schema-valid and useful on its own, so
// the critique/refine phase degrades gracefully: if it fails (slow free-tier
// model, malformed critique JSON, timeout), we keep the best result so far and
// still return a `final`. Only a failed `analyze` — where there is no draft at
// all — surfaces as a typed error. Emits step/draft/critique/final events.
export async function runAnalysis(input: AgentInput, ctx: AgentContext): Promise<Analysis> {
  // Phase 1 — draft. A failure here is fatal: there is nothing to return.
  let best: Analysis;
  try {
    ctx.emit({ type: "step", step: "analyze", status: "start" });
    best = await analyzeStep(input, ctx);
    ctx.emit({ type: "draft", result: best });
    ctx.emit({ type: "step", step: "analyze", status: "finish" });
  } catch (err) {
    ctx.emit({ type: "error", message: "Analysis failed. Please try again." });
    throw err;
  }

  // Phase 2 — reflection. Best-effort: any failure leaves `best` as the draft.
  try {
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
  } catch {
    // Reflection failed — fall back to the valid draft rather than failing the
    // whole request. The aborted step's lack of a "finish" event is the signal.
  }

  ctx.emit({ type: "final", result: best });
  return best;
}
