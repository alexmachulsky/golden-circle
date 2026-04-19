import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Shared mock for groq create — replaced per-test as needed ───────────────
const mockCreate = vi.fn();
const originalFetch = global.fetch;
const DEFAULT_IDEA = "A business idea that is at least fifty characters long for testing.";
const tempDirs: string[] = [];

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
    body = { businessIdea: DEFAULT_IDEA },
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

function createSecretFile(name: string, value: string): string {
  const dir = mkdtempSync(join(tmpdir(), "golden-circle-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, value, "utf8");
  return filePath;
}

function mockProductionFetch(options?: { turnstileSuccess?: boolean }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === "https://redis.example/multi-exec") {
      return new Response(
        JSON.stringify([{ result: "OK" }, { result: 1 }, { result: 60_000 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return new Response(
        JSON.stringify({ success: options?.turnstileSuccess ?? true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
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
  delete process.env.UPSTASH_REDIS_REST_TOKEN_FILE;
  delete process.env.GROQ_API_KEY_FILE;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SITE_KEY_FILE;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_FILE;
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.TEST_TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN_FILE;
  delete process.env.GROQ_API_KEY_FILE;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SITE_KEY_FILE;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_FILE;
  setNodeEnv("test");
  global.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
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

  it("returns 503 in production when Redis is not configured", async () => {
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

describe("Runtime secret files", () => {
  it("accepts GROQ_API_KEY_FILE when the direct env var is absent", async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY_FILE = createSecretFile("groq-api-key.txt", "file-backed-key");

    mockCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "{}" } }] };
      })(),
    );

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
  });
});

describe("Challenge verification", () => {
  function enableProductionChallenge() {
    setNodeEnv("production");
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
  }

  it("returns 403 in production when the verification token is missing", async () => {
    enableProductionChallenge();
    const fetchMock = mockProductionFetch();

    const res = await POST(makeReq({ headers: { "x-client-ip": "203.0.113.10" } }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Verification required." });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when Turnstile rejects the submitted token", async () => {
    enableProductionChallenge();
    const fetchMock = mockProductionFetch({ turnstileSuccess: false });

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Verification failed." });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("verifies Turnstile in production before streaming the model response", async () => {
    enableProductionChallenge();
    const fetchMock = mockProductionFetch();
    const chunks = ['{"why":', '{"statement":"Test"}}'];
    mockCreate.mockResolvedValue(
      (async function* () {
        for (const chunk of chunks) {
          yield { choices: [{ delta: { content: chunk } }] };
        }
      })(),
    );

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe('{"why":{"statement":"Test"}}');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const challengeBody = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
    expect(challengeBody).toContain("secret=turnstile-secret");
    expect(challengeBody).toContain("response=token-from-widget");
    expect(challengeBody).toContain("remoteip=203.0.113.10");
  });

  it("accepts TURNSTILE_SECRET_KEY_FILE when Turnstile is enabled", async () => {
    setNodeEnv("production");
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY_FILE = createSecretFile("turnstile-secret.txt", "file-secret");
    const fetchMock = mockProductionFetch();

    mockCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "{}" } }] };
      })(),
    );

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
    const challengeBody = String(fetchMock.mock.calls[1]?.[1]?.body ?? "");
    expect(challengeBody).toContain("secret=file-secret");
  });

  it("accepts TURNSTILE_SITE_KEY_FILE when Turnstile is enabled", async () => {
    setNodeEnv("production");
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    delete process.env.TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SITE_KEY_FILE = createSecretFile("turnstile-site-key.txt", "file-site-key");
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const fetchMock = mockProductionFetch();

    mockCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "{}" } }] };
      })(),
    );

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
