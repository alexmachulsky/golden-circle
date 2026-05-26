import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCacheForTesting,
  computeCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
} from "./analyze-cache";

// A well-formed response that satisfies parseAnalysis (the same validator the
// client uses). The cache must only store responses that actually parse.
const VALID_RESPONSE = JSON.stringify({
  why: {
    statement: "We believe everyone deserves clarity about what they buy.",
    depth_note: "This holds true even if the product line changes entirely.",
  },
  how: [
    { title: "Open methods", description: "We publish how we work.", uniqueness: "Rivals guard theirs." },
    { title: "Transparent pricing", description: "We show every fee.", uniqueness: "Others bury costs." },
    { title: "Customer councils", description: "We co-design with users.", uniqueness: "Few cede control." },
    { title: "Values-first hiring", description: "We hire for belief.", uniqueness: "Most hire for speed." },
  ],
  what: [
    { title: "Dashboard", description: "A clarity dashboard.", why_connection: "Because we believe in clarity." },
    { title: "Reports", description: "Plain-language reports.", why_connection: "This proves our belief." },
    { title: "Open API", description: "Free data access.", why_connection: "Because we believe in openness." },
  ],
  positioning_note: "We win by leading with belief, not feature lists.",
});

// The first half of VALID_RESPONSE — what the client receives when a stream is
// cut off mid-object. Starts with "{" and has no "__ERROR__", so the old
// substring check wrongly accepted it.
const TRUNCATED_RESPONSE = VALID_RESPONSE.slice(0, VALID_RESPONSE.length / 2);

beforeEach(() => {
  _resetCacheForTesting();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("computeCacheKey", () => {
  it("produces a stable sha256 hex digest", () => {
    const a = computeCacheKey("hello");
    const b = computeCacheKey("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different keys for different inputs", () => {
    expect(computeCacheKey("a")).not.toBe(computeCacheKey("b"));
  });
});

describe("in-memory cache", () => {
  it("returns null on miss", async () => {
    expect(await getCachedAnalysis("missing")).toBeNull();
  });

  it("stores and retrieves a valid analysis payload", async () => {
    await setCachedAnalysis("k", VALID_RESPONSE);
    expect(await getCachedAnalysis("k")).toBe(VALID_RESPONSE);
  });

  it("does not cache a truncated response that starts with '{'", async () => {
    // Regression: a stream cut off mid-object parses-fails on the client
    // ("Could not parse the AI response"). Caching it would make that error
    // stick for every identical request for the full TTL.
    await setCachedAnalysis("k", TRUNCATED_RESPONSE);
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("does not cache valid JSON that violates the analysis schema", async () => {
    await setCachedAnalysis("k", '{"why":{}}');
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("does not cache error sentinels", async () => {
    await setCachedAnalysis("k", "__ERROR__boom");
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("does not cache non-JSON payloads", async () => {
    await setCachedAnalysis("k", "plain text");
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("does not cache JSON containing the error sentinel", async () => {
    await setCachedAnalysis("k", '{"x":"__ERROR__"}');
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    await setCachedAnalysis("k", VALID_RESPONSE);
    expect(await getCachedAnalysis("k")).toBe(VALID_RESPONSE);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("_resetCacheForTesting clears state", async () => {
    await setCachedAnalysis("k", VALID_RESPONSE);
    _resetCacheForTesting();
    expect(await getCachedAnalysis("k")).toBeNull();
  });
});
