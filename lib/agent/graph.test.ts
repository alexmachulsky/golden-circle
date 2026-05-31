import { describe, it, expect, vi } from "vitest";

const draft = {
  why: { statement: "s", depth_note: "n" },
  how: Array.from({ length: 4 }, () => ({ title: "t", description: "d", uniqueness: "u" })),
  what: Array.from({ length: 3 }, () => ({ title: "t", description: "d", why_connection: "w" })),
  positioning_note: "p",
};
const refined = { ...draft, positioning_note: "p2" };

vi.mock("@/lib/agent/steps/analyze", () => ({ analyzeStep: vi.fn(async () => draft) }));
vi.mock("@/lib/agent/steps/critique", () => ({ critiqueStep: vi.fn() }));
vi.mock("@/lib/agent/steps/refine", () => ({ refineStep: vi.fn(async () => refined) }));

import { runAnalysis } from "@/lib/agent/graph";
import { critiqueStep } from "@/lib/agent/steps/critique";
import type { AgentContext } from "@/lib/agent/state";
import type { AgentEvent } from "@/lib/agent/events";

function ctxWith(events: AgentEvent[]): AgentContext {
  return {
    model: {} as never,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  };
}

const passing = {
  scores: { specificity: 5, nongeneric: 5, fidelity: 5, actionability: 5 },
  overall: 5,
  weaknesses: [],
  pass: true,
};
const failing = {
  scores: { specificity: 2, nongeneric: 2, fidelity: 3, actionability: 3 },
  overall: 2.5,
  weaknesses: ["HOW #2 generic"],
  pass: false,
};

describe("runAnalysis reflection loop", () => {
  it("returns the draft and skips refine when critique passes", async () => {
    vi.mocked(critiqueStep).mockResolvedValueOnce(passing as never);
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(draft);
    expect(events.map((e) => e.type)).toEqual([
      "step",
      "draft",
      "step",
      "step",
      "critique",
      "step",
      "final",
    ]);
    expect(events.some((e) => e.type === "step" && e.step === "refine")).toBe(false);
  });

  it("refines and returns the refined result when critique fails", async () => {
    vi.mocked(critiqueStep).mockResolvedValueOnce(failing as never);
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(refined);
    expect(
      events.some((e) => e.type === "step" && e.step === "refine" && e.status === "finish"),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "final", result: refined });
  });

  it("emits an error event and rethrows when analyze (the draft) fails", async () => {
    const mod = await import("@/lib/agent/steps/analyze");
    vi.mocked(mod.analyzeStep).mockRejectedValueOnce(new Error("model down"));
    const events: AgentEvent[] = [];
    await expect(
      runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events)),
    ).rejects.toThrow("model down");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("falls back to the draft (no error) when critique fails", async () => {
    vi.mocked(critiqueStep).mockRejectedValueOnce(new Error("bad critique json"));
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(draft);
    expect(events.at(-1)).toMatchObject({ type: "final", result: draft });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("falls back to the draft (no error) when refine fails after a failing critique", async () => {
    const refineMod = await import("@/lib/agent/steps/refine");
    vi.mocked(critiqueStep).mockResolvedValueOnce(failing as never);
    vi.mocked(refineMod.refineStep).mockRejectedValueOnce(new Error("refine timeout"));
    const events: AgentEvent[] = [];
    const result = await runAnalysis({ mode: "idea", text: "x", refinement: null }, ctxWith(events));
    expect(result).toEqual(draft);
    expect(events.at(-1)).toMatchObject({ type: "final", result: draft });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});
