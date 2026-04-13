import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetStoreForTesting, checkRateLimit, getClientKey, RateLimitError } from "./rate-limit";

// Reset the internal store between tests by re-importing after vi.resetModules
// or by using separate keys per test to avoid cross-test bleed.

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = value;
}

describe('checkRateLimit', () => {
  // Use unique keys per test to avoid cross-contamination
  let testId: number;
  beforeEach(() => {
    setNodeEnv("test");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetStoreForTesting();
    testId = Math.random();
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    setNodeEnv("test");
    global.fetch = originalFetch;
    _resetStoreForTesting();
  });

  const originalFetch = global.fetch;

  it("allows requests under the limit", async () => {
    const key = `test-${testId}`;
    await expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 })).resolves.toBe(true);
    await expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 })).resolves.toBe(true);
    await expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 })).resolves.toBe(true);
  });

  it("blocks the request at the limit", async () => {
    const key = `test-${testId}`;
    await checkRateLimit(key, { limit: 2, windowMs: 60_000 });
    await checkRateLimit(key, { limit: 2, windowMs: 60_000 });
    await expect(checkRateLimit(key, { limit: 2, windowMs: 60_000 })).resolves.toBe(false);
  });

  it("resets after the window expires", () => {
    const key = `test-${testId}`;
    // Fill the window
    void checkRateLimit(key, { limit: 1, windowMs: 1 }); // 1 ms window
    // Wait for it to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        void expect(checkRateLimit(key, { limit: 1, windowMs: 1 })).resolves.toBe(true).finally(resolve);
      }, 10);
    });
  });

  it("tracks separate keys independently", async () => {
    const keyA = `test-a-${testId}`;
    const keyB = `test-b-${testId}`;
    await checkRateLimit(keyA, { limit: 1, windowMs: 60_000 });
    // keyA is now at limit but keyB should still be allowed
    await expect(checkRateLimit(keyA, { limit: 1, windowMs: 60_000 })).resolves.toBe(false);
    await expect(checkRateLimit(keyB, { limit: 1, windowMs: 60_000 })).resolves.toBe(true);
  });

  it("requires a shared rate-limit backend in production", async () => {
    setNodeEnv("production");

    await expect(checkRateLimit("test-production", { limit: 1, windowMs: 60_000 })).rejects.toThrow(
      RateLimitError,
    );
  });

  it("uses the Upstash transaction API when production Redis credentials are configured", async () => {
    setNodeEnv("production");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ result: "OK" }, { result: 1 }, { result: 60_000 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(checkRateLimit("203.0.113.10", { limit: 2, windowMs: 60_000 })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://redis.example/multi-exec",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("blocks requests when the shared counter exceeds the limit", async () => {
    setNodeEnv("production");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ result: null }, { result: 3 }, { result: 45_000 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(checkRateLimit("203.0.113.10", { limit: 2, windowMs: 60_000 })).resolves.toBe(false);
  });
});

describe("getClientKey", () => {
  function makeReq(headers: Record<string, string>): Request {
    return new Request("http://localhost/", { method: "POST", headers });
  }

  beforeEach(() => {
    setNodeEnv("test");
  });

  afterEach(() => {
    setNodeEnv("test");
  });

  it("uses the trusted header when TRUSTED_IP_HEADER is configured", () => {
    const req = makeReq({ "x-client-ip": "1.2.3.4" });
    expect(getClientKey(req, "x-client-ip")).toBe("1.2.3.4");
  });

  it("normalizes comma-delimited trusted header values to the first hop", () => {
    const req = makeReq({ "x-client-ip": "1.2.3.4, 5.6.7.8" });
    expect(getClientKey(req, "x-client-ip")).toBe("1.2.3.4");
  });

  it("returns __local__ when no TRUSTED_IP_HEADER is configured outside production", () => {
    const req = makeReq({ "x-forwarded-for": "9.9.9.9" });
    // x-forwarded-for is intentionally ignored when no trusted header is set
    expect(getClientKey(req, null)).toBe("__local__");
  });

  it("does not trust x-forwarded-for when no trusted header is configured", () => {
    const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getClientKey(req, null)).toBe("__local__");
  });

  it("fails closed in production when TRUSTED_IP_HEADER is missing", () => {
    setNodeEnv("production");
    const req = makeReq({});
    expect(() => getClientKey(req, null)).toThrow(RateLimitError);
  });

  it("fails closed in production when the trusted header is absent on the request", () => {
    setNodeEnv("production");
    const req = makeReq({});
    expect(() => getClientKey(req, "x-client-ip")).toThrow(RateLimitError);
  });
});
