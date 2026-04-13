import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Shared mock for groq create — replaced per-test as needed ───────────────
const mockCreate = vi.fn();
const originalFetch = global.fetch;

// ── Mock groq-sdk before importing the route ────────────────────────────────
vi.mock('groq-sdk', () => {
  return {
    default: class MockGroq {
      chat = { completions: { create: mockCreate } };
    },
  };
});

// ── Mock config so origin / rate-limit values are controlled ────────────────
vi.mock('@/lib/config', () => ({
  ALLOWED_ORIGINS: ["http://localhost:7001"],
  RATE_LIMIT_PER_MIN: 5,
  get TRUSTED_IP_HEADER() {
    return process.env.TEST_TRUSTED_IP_HEADER ?? null;
  },
}));

import { POST } from "./route";
import { _resetStoreForTesting } from "@/lib/rate-limit";

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = value;
}

// Helper: build a Request for the analyze endpoint
function makeReq(options: {
  body?: unknown;
  contentType?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}): Request {
  const {
    body = { businessIdea: "A business idea that is at least fifty characters long for testing." },
    contentType = "application/json",
    origin = "http://localhost:7001",
    headers = {},
  } = options;

  const reqHeaders: Record<string, string> = { ...headers };
  if (contentType) reqHeaders["content-type"] = contentType;
  if (origin !== null) reqHeaders["origin"] = origin;

  return new Request("http://localhost:7001/api/analyze", {
    method: "POST",
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Helper: collect the full streamed text from a streaming Response
async function collectStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

beforeEach(() => {
  mockCreate.mockReset();
  _resetStoreForTesting();
  process.env.GROQ_API_KEY = "test-key";
  setNodeEnv("test");
  delete process.env.TEST_TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.TEST_TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  setNodeEnv("test");
  global.fetch = originalFetch;
});

describe("Content-Type guard", () => {
  it("returns 415 for non-JSON content type", async () => {
    const req = makeReq({ contentType: "text/plain" });
    const res = await POST(req);
    expect(res.status).toBe(415);
    const json = await res.json();
    expect(json.error).toContain("application/json");
  });

  it("returns 415 for form-encoded content type", async () => {
    const req = makeReq({ contentType: "application/x-www-form-urlencoded" });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });
});

describe("Origin guard", () => {
  it("returns 403 for a disallowed origin", async () => {
    const req = makeReq({ origin: "https://evil.example" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    // Must not leak detailed info
    expect(json.error).toBe("Forbidden.");
  });
});

describe("Body size guard", () => {
  it("returns 413 when body exceeds limit", async () => {
    const oversized = "x".repeat(9 * 1024); // 9 KB > 8 KB limit
    const req = new Request("http://localhost:7001/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:7001",
        "content-length": String(oversized.length),
      },
      body: oversized,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});

describe("Rate limit guard", () => {
  it("returns 429 after exceeding the per-minute limit", async () => {
    mockCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "{}" } }] };
      })(),
    );

    const results: number[] = [];
    for (let i = 0; i < 7; i++) {
      const req = new Request("http://localhost:7001/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:7001",
        },
        body: JSON.stringify({
          businessIdea: "A business idea that is at least fifty characters long for testing.",
        }),
      });
      const res = await POST(req);
      results.push(res.status);
    }
    // First 5 allowed (200 streaming), then 2 rate-limited (429)
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  });

  it("returns 503 in production when the shared limiter is not configured", async () => {
    setNodeEnv("production");

    const res = await POST(makeReq({}));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Service unavailable." });
  });

  it("returns 503 in production when the trusted client identity is missing", async () => {
    setNodeEnv("production");
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    global.fetch = vi.fn() as typeof fetch;

    const res = await POST(makeReq({}));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Service unavailable." });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("Error message hygiene", () => {
  it("returns generic message, not GROQ_API_KEY text, when key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const req = makeReq({});
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).not.toContain("GROQ_API_KEY");
    expect(json.error).not.toContain("configure");
  });

  it("streams generic __ERROR__ message, not raw exception, on upstream failure", async () => {
    mockCreate.mockRejectedValue(new Error("Internal provider error 500 secret details"));

    const req = makeReq({});
    const res = await POST(req);
    expect(res.status).toBe(200); // stream starts before error
    const text = await collectStream(res);
    expect(text).toContain("__ERROR__");
    expect(text).not.toContain("secret details");
    expect(text).not.toContain("Internal provider");
  });
});

describe("Happy path", () => {
  it("streams the model response text", async () => {
    const chunks = ['{"why":', '{"statement":"Test"}}'];
    mockCreate.mockResolvedValue(
      (async function* () {
        for (const chunk of chunks) {
          yield { choices: [{ delta: { content: chunk } }] };
        }
      })(),
    );

    const req = makeReq({});
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const text = await collectStream(res);
    expect(text).toBe('{"why":{"statement":"Test"}}');
  });
});
