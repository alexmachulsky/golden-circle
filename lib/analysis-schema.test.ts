import { describe, it, expect } from "vitest";
import { analysisSchema } from "@/lib/analysis-schema";

const how = { title: "t", description: "d", uniqueness: "u" };
const what = { title: "t", description: "d", why_connection: "w" };
const valid = () => ({
  why: { statement: "s", depth_note: "n" },
  how: [how, how, how, how],
  what: [what, what, what],
  positioning_note: "p",
});

describe("analysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(analysisSchema.safeParse(valid()).success).toBe(true);
  });
  it("rejects wrong how length", () => {
    expect(analysisSchema.safeParse({ ...valid(), how: [how, how, how] }).success).toBe(false);
  });
  it("rejects wrong what length", () => {
    expect(analysisSchema.safeParse({ ...valid(), what: [what, what] }).success).toBe(false);
  });
  it("accepts optional citations + confidence", () => {
    expect(
      analysisSchema.safeParse({
        ...valid(),
        citations: [{ claim: "c", source: "Acme 10-K", url: "https://example.com" }],
        confidence: { why: 0.9, how: 0.8, what: 0.7 },
      }).success,
    ).toBe(true);
  });
});
