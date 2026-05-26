import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types";
import {
  tryBuildShareUrl,
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
  it("round-trips an AnalysisResult through the hash encoding", async () => {
    const encoded = await encodeAnalysisForUrl(sample);
    const decoded = await decodeAnalysisFromHash(`#data=${encoded}`);
    expect(decoded).toEqual(sample);
  });

  it("uses the compressed (v1.) scheme when CompressionStream is available", async () => {
    const encoded = await encodeAnalysisForUrl(sample);
    expect(encoded.startsWith("v1.")).toBe(true);
  });

  it("produces a URL-safe payload (no +, /, or = padding)", async () => {
    const encoded = await encodeAnalysisForUrl(sample);
    // Strip the scheme marker before checking the base64url body.
    const body = encoded.replace(/^v1\./, "");
    expect(body).not.toMatch(/[+/=]/);
  });

  it("still decodes a legacy uncompressed (raw base64url) payload", async () => {
    // Simulate a link produced before compression existed: base64url(JSON).
    const json = JSON.stringify(sample);
    const b64url = Buffer.from(json, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const decoded = await decodeAnalysisFromHash(`#data=${b64url}`);
    expect(decoded).toEqual(sample);
  });

  it("tryBuildShareUrl composes origin + pathname + hash", async () => {
    const url = await tryBuildShareUrl(sample, "https://example.com", "/golden");
    expect(url).not.toBeNull();
    expect(url!.startsWith("https://example.com/golden#data=")).toBe(true);
  });

  it("tryBuildShareUrl returns null when the encoded payload exceeds the budget", async () => {
    // A result whose fields are large enough that even gzip can't fit 8 KB.
    const huge: AnalysisResult = {
      ...sample,
      // High-entropy random text so gzip can't shrink it under the 8 KB budget.
      positioning_note: Array.from({ length: 30000 }, () =>
        String.fromCharCode(33 + Math.floor(Math.random() * 90)),
      ).join(""),
    };
    const url = await tryBuildShareUrl(huge, "https://example.com", "/x");
    expect(url).toBeNull();
  });

  it("returns null when the hash has no data prefix", async () => {
    expect(await decodeAnalysisFromHash("")).toBeNull();
    expect(await decodeAnalysisFromHash("#other=abc")).toBeNull();
  });

  it("returns null when the payload exceeds the size cap", async () => {
    const big = "a".repeat(9 * 1024);
    expect(await decodeAnalysisFromHash(`#data=${big}`)).toBeNull();
  });

  it("returns null on malformed payloads", async () => {
    expect(await decodeAnalysisFromHash("#data=!!!not-base64!!!")).toBeNull();
    expect(await decodeAnalysisFromHash("#data=v1.!!!not-gzip!!!")).toBeNull();
  });

  it("returns null when the decoded payload fails schema validation", async () => {
    const bad = await encodeAnalysisForUrl({ ...sample, how: sample.how.slice(0, 2) } as AnalysisResult);
    expect(await decodeAnalysisFromHash(`#data=${bad}`)).toBeNull();
  });
});
