import { describe, it, expect } from "vitest";
import { encodeEvent, parseEventLines, type AgentEvent } from "@/lib/agent/events";

describe("agent event codec", () => {
  it("encodes one newline-terminated JSON line", () => {
    const out = encodeEvent({ type: "step", step: "analyze", status: "start" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });
  it("round-trips a sequence", () => {
    const evts: AgentEvent[] = [
      { type: "step", step: "analyze", status: "start" },
      { type: "error", message: "boom" },
    ];
    const { events, rest } = parseEventLines(evts.map(encodeEvent).join(""));
    expect(events).toEqual(evts);
    expect(rest).toBe("");
  });
  it("keeps a trailing partial line in rest", () => {
    const buf =
      encodeEvent({ type: "step", step: "critique", status: "finish" }) + '{"type":"er';
    const { events, rest } = parseEventLines(buf);
    expect(events).toHaveLength(1);
    expect(rest).toBe('{"type":"er');
  });
});
