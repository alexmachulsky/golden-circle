import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCacheForTesting,
  computeCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
} from "./analyze-cache";

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

  it("stores and retrieves a JSON payload", async () => {
    await setCachedAnalysis("k", '{"why":{}}');
    expect(await getCachedAnalysis("k")).toBe('{"why":{}}');
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
    await setCachedAnalysis("k", '{"a":1}');
    expect(await getCachedAnalysis("k")).toBe('{"a":1}');
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(await getCachedAnalysis("k")).toBeNull();
  });

  it("_resetCacheForTesting clears state", async () => {
    await setCachedAnalysis("k", '{"a":1}');
    _resetCacheForTesting();
    expect(await getCachedAnalysis("k")).toBeNull();
  });
});
