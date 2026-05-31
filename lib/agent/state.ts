import type { LanguageModel } from "ai";
import type { RefinementKey } from "@/lib/prompt";
import type { AgentEvent } from "@/lib/agent/events";

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
  emit: (event: AgentEvent) => void;
}
