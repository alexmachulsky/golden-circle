import { describe, it, expect, vi } from "vitest";

// Replace the analyze node so the graph test never touches the network.
vi.mock("@/lib/agent/steps/analyze", () => ({
  analyzeStep: async function* () {
    yield "Hello ";
    yield "world";
  },
}));

import { runAnalysisStream } from "@/lib/agent/graph";
import type { AgentContext } from "@/lib/agent/state";

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

describe("runAnalysisStream", () => {
  it("yields the analyze node's deltas in order", async () => {
    const ctx = { model: {} as never, signal: new AbortController().signal } as AgentContext;
    const text = await collect(runAnalysisStream({ mode: "idea", text: "x", refinement: null }, ctx));
    expect(text).toBe("Hello world");
  });
});
