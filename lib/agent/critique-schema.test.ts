import { describe, it, expect } from "vitest";
import { critiqueSchema } from "@/lib/agent/critique-schema";

const valid = {
  scores: { specificity: 4, nongeneric: 5, fidelity: 4, actionability: 3 },
  overall: 4,
  weaknesses: ["HOW #2 is generic"],
  pass: true,
};

describe("critiqueSchema", () => {
  it("accepts a well-formed critique", () => {
    expect(critiqueSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a score out of 1..5", () => {
    expect(
      critiqueSchema.safeParse({ ...valid, scores: { ...valid.scores, specificity: 9 } }).success,
    ).toBe(false);
  });
  it("rejects a missing pass flag", () => {
    const { pass: _omit, ...rest } = valid;
    void _omit;
    expect(critiqueSchema.safeParse(rest).success).toBe(false);
  });
});
