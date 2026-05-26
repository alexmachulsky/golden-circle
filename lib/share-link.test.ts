import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types";
import {
  buildShareUrl,
  decodeAnalysisFromHash,
  encodeAnalysisForUrl,
} from "./share-link";

const sample: AnalysisResult = {
  why: { statement: "We believe in clarity.", depth_note: "Belief survives a product swap." },
  how: [
    { title: "Action 1", description: "Desc 1", uniqueness: "Unique 1" },
    { title: "Action 2", description: "Desc 2", uniqueness: "Unique 2" },
    { title: "Action 3", description: "Desc 3", uniqueness: "Unique 3" },
    { title: "Action 4", description: "Desc 4", uniqueness: "Unique 4" },
  ],
  what: [
    { title: "Product 1", description: "Desc 1", why_connection: "Proof 1" },
    { title: "Product 2", description: "Desc 2", why_connection: "Proof 2" },
    { title: "Product 3", description: "Desc 3", why_connection: "Proof 3" },
  ],
  positioning_note: "Strategic edge.",
};

describe("share-link", () => {
  it("round-trips an AnalysisResult through the hash encoding", () => {
    const encoded = encodeAnalysisForUrl(sample);
    const decoded = decodeAnalysisFromHash(`#data=${encoded}`);
    expect(decoded).toEqual(sample);
  });

  it("produces a base64url string with no padding", () => {
    const encoded = encodeAnalysisForUrl(sample);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("buildShareUrl composes origin + pathname + hash", () => {
    const url = buildShareUrl(sample, "https://example.com", "/golden");
    expect(url.startsWith("https://example.com/golden#data=")).toBe(true);
  });

  it("returns null when the hash has no data prefix", () => {
    expect(decodeAnalysisFromHash("")).toBeNull();
    expect(decodeAnalysisFromHash("#other=abc")).toBeNull();
  });

  it("returns null when the encoded payload exceeds the size cap", () => {
    const big = "a".repeat(9 * 1024);
    expect(decodeAnalysisFromHash(`#data=${big}`)).toBeNull();
  });

  it("returns null on malformed base64", () => {
    expect(decodeAnalysisFromHash("#data=!!!not-base64!!!")).toBeNull();
  });

  it("returns null when the decoded payload fails schema validation", () => {
    const bad = encodeAnalysisForUrl({ ...sample, how: sample.how.slice(0, 2) } as AnalysisResult);
    expect(decodeAnalysisFromHash(`#data=${bad}`)).toBeNull();
  });
});
