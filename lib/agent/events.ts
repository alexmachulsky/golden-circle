import type { Analysis } from "@/lib/analysis-schema";
import type { Critique } from "@/lib/agent/critique-schema";

// Newline-delimited JSON event protocol streamed from /api/analyze. One JSON
// object per line keeps client parsing trivial and survives chunk boundaries.
export type StepName = "analyze" | "critique" | "refine";

export type AgentEvent =
  | { type: "step"; step: StepName; status: "start" | "finish"; summary?: string }
  | { type: "draft"; result: Analysis }
  | { type: "critique"; critique: Critique }
  | { type: "final"; result: Analysis }
  | { type: "error"; message: string };

export function encodeEvent(event: AgentEvent): string {
  return JSON.stringify(event) + "\n";
}

// Parses as many complete lines as possible from `buffer`. Returns the parsed
// events and any trailing partial line (`rest`) to prepend to the next chunk.
export function parseEventLines(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      // Skip an unparseable line rather than aborting the whole stream.
    }
  }
  return { events, rest };
}
