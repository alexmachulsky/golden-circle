import { describe, it, expect } from "vitest";
import { extractObject } from "@/lib/agent/generate-json";

describe("extractObject", () => {
  it("parses a clean JSON object", () => {
    expect(extractObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips markdown code fences", () => {
    expect(extractObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts the object from surrounding prose", () => {
    expect(extractObject('Here you go: {"a":1} — done')).toEqual({ a: 1 });
  });
  it("tolerates trailing commas", () => {
    expect(extractObject('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("throws when there is no object", () => {
    expect(() => extractObject("no json here")).toThrow();
  });
});
