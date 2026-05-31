import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Shared mock for the streamText call — replaced per-test as needed ─
const mockStreamText = vi.fn();
const originalFetch = global.fetch;
const DEFAULT_IDEA = "A business idea that is at least fifty characters long for testing.";
const tempDirs: string[] = [];

// ── Mock the AI SDK streamText before importing the route ──────────────────
vi.mock("ai", () => ({
  streamText: (opts: unknown) => mockStreamText(opts),
}));

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
import { _resetCacheForTesting } from "@/lib/analyze-cache";
import { MAX_INPUT_LENGTH } from "@/lib/constants";

// A schema-valid AnalysisResult JSON (passes parseAnalysis → eligible for caching).
const VALID_RESULT = JSON.stringify({
  why: { statement: "We believe in clarity.", depth_note: "True even after a product swap." },
  how: [
    { title: "H1", description: "D1", uniqueness: "U1" },
    { title: "H2", description: "D2", uniqueness: "U2" },
    { title: "H3", description: "D3", uniqueness: "U3" },
    { title: "H4", description: "D4", uniqueness: "U4" },
  ],
  what: [
    { title: "W1", description: "D1", why_connection: "Because we believe." },
    { title: "W2", description: "D2", why_connection: "Because we believe." },
    { title: "W3", description: "D3", why_connection: "Because we believe." },
  ],
  positioning_note: "Inside-out edge.",
});

function userPromptOf(call: number = 0): string {
  return String(mockStreamText.mock.calls[call]?.[0]?.prompt ?? "");
}

function streamOnce(text: string) {
  mockStreamText.mockReturnValue({
    textStream: (async function* () { yield text; })(),
  });
}

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = value;
}

function setDeploymentMode(value: string | undefined): void {
  (process.env as Record<string, string | undefined>)["DEPLOYMENT_MODE"] = value;
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
      // Mirror Cloudflare's full success response so the server-side
      // hostname/action validation has the fields it expects.
      const body = options?.turnstileSuccess === false
        ? { success: false, "error-codes": ["invalid-input-response"] }
        : { success: true, action: "analyze", hostname: "localhost" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
  mockStreamText.mockReset();
  _resetStoreForTesting();
  _resetCacheForTesting();
  process.env.OPENROUTER_API_KEY = "test-key";
  // verifyTurnstileToken reads ALLOWED_ORIGINS from process.env (not the mocked
  // @/lib/config) for hostname binding; "localhost" matches mockProductionFetch.
  process.env.ALLOWED_ORIGINS = "http://localhost:7001";
  setNodeEnv("test");
  setDeploymentMode(undefined);
  delete process.env.TEST_TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN_FILE;
  delete process.env.OPENROUTER_API_KEY_FILE;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SITE_KEY_FILE;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_FILE;
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.TEST_TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN_FILE;
  delete process.env.OPENROUTER_API_KEY_FILE;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SITE_KEY_FILE;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_FILE;
  setNodeEnv("test");
  setDeploymentMode(undefined);
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
    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

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
    setDeploymentMode("public");

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
  it("returns generic message, not OPENROUTER_API_KEY text, when key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const req = makeReq({});
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).not.toContain("OPENROUTER_API_KEY");
    expect(json.error).not.toContain("configure");
  });

  it("streams generic __ERROR__ message, not raw exception, on upstream failure", async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () { throw new Error("Internal provider error 500 secret details"); })(),
    });

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
  it("accepts OPENROUTER_API_KEY_FILE when the direct env var is absent", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY_FILE = createSecretFile("groq-api-key.txt", "file-backed-key");

    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

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
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 in public production when Turnstile is not configured", async () => {
    setNodeEnv("production");
    setDeploymentMode(undefined);
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    const fetchMock = mockProductionFetch();

    const res = await POST(makeReq({ headers: { "x-client-ip": "203.0.113.10" } }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Service unavailable." });
    expect(mockStreamText).not.toHaveBeenCalled();
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
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("verifies Turnstile in production before streaming the model response", async () => {
    enableProductionChallenge();
    const fetchMock = mockProductionFetch();
    const chunks = ['{"why":', '{"statement":"Test"}}'];
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        for (const c of chunks) yield c;
      })(),
    });

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe('{"why":{"statement":"Test"}}');
    expect(mockStreamText).toHaveBeenCalledTimes(1);
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

  it("fails closed (503) in public production when ALLOWED_ORIGINS has no valid hostname", async () => {
    setNodeEnv("production");
    process.env.TEST_TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.ALLOWED_ORIGINS = ""; // no hostnames → hostname binding impossible
    mockProductionFetch();

    const res = await POST(makeReq({
      headers: { "x-client-ip": "203.0.113.10" },
      body: { businessIdea: DEFAULT_IDEA, turnstileToken: "token-from-widget" },
    }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Service unavailable." });
    expect(mockStreamText).not.toHaveBeenCalled();
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

    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

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

    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

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
  it("allows a local single-container deployment in production mode", async () => {
    setNodeEnv("production");
    setDeploymentMode("local");

    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
  });

  it("accepts a null turnstileToken when Turnstile is not configured", async () => {
    // The client sends `turnstileToken: null` whenever the widget is absent;
    // the type guard must treat null like undefined, not reject it as malformed.
    mockStreamText.mockReturnValue({
      textStream: (async function* () { yield "{}"; })(),
    });

    const res = await POST(makeReq({ body: { businessIdea: DEFAULT_IDEA, turnstileToken: null } }));
    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
  });

  it("rejects a non-string, non-null turnstileToken as malformed", async () => {
    const res = await POST(makeReq({ body: { businessIdea: DEFAULT_IDEA, turnstileToken: 123 } }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "turnstileToken must be a string." });
  });

  it("streams the model response text", async () => {
    const chunks = ['{"why":', '{"statement":"Test"}}'];
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        for (const c of chunks) yield c;
      })(),
    });

    const req = makeReq({});
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const text = await collectStream(res);
    expect(text).toBe('{"why":{"statement":"Test"}}');
  });
});

describe("Streaming edge cases", () => {
  it("skips chunks with empty/undefined delta content", async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield undefined as unknown as string;
        yield "";
        yield "{}";
      })(),
    });
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    await expect(collectStream(res)).resolves.toBe("{}");
  });

  it("rejects a prompt-injected response that emits the error sentinel before the JSON", async () => {
    streamOnce('__ERROR__leaked attacker text{"why":1}');
    const res = await POST(makeReq({}));
    const text = await collectStream(res);
    expect(text).toBe("__ERROR__Analysis failed. Please try again.");
    expect(text).not.toContain("leaked attacker text");
  });

  it("reports a timeout when the SDK aborts (APIUserAbortError)", async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
      })(),
    });
    const res = await POST(makeReq({}));
    const text = await collectStream(res);
    expect(text).toContain("timed out");
  });

  it("cuts off and does not cache a response that exceeds the server byte cap", async () => {
    // Stream a valid JSON opening so the prefix-check passes immediately,
    // then a long payload that pushes assembled length past 32 KB.
    const opener = '{"why":"';
    const filler = "x".repeat(40 * 1024);
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield opener;
        yield filler;
        // This chunk must never be forwarded — the cap should have closed the stream.
        yield '","trailing":true}';
      })(),
    });

    const res = await POST(makeReq({}));
    const text = await collectStream(res);
    expect(text.endsWith("__ERROR__Response exceeded maximum size.")).toBe(true);
    expect(text).not.toContain('"trailing":true');
    // Let any fire-and-forget cache write settle, then confirm the next call
    // still goes upstream (truncated payloads must never be cached).
    await new Promise((r) => setTimeout(r, 0));
    streamOnce(VALID_RESULT);
    const second = await POST(makeReq({}));
    await expect(collectStream(second)).resolves.toBe(VALID_RESULT);
    expect(mockStreamText).toHaveBeenCalledTimes(2);
  });
});

describe("Input sanitization", () => {
  it("strips HTML tags from the business idea before prompting the model", async () => {
    streamOnce("{}");
    const idea = "Our mission <script>alert(1)</script> is to help people thrive every day for sure.";
    await POST(makeReq({ body: { businessIdea: idea } }));
    const prompt = userPromptOf();
    expect(prompt).not.toContain("<script>");
    expect(prompt).not.toContain("</script>");
  });

  it("truncates the business idea to MAX_INPUT_LENGTH", async () => {
    streamOnce("{}");
    await POST(makeReq({ body: { businessIdea: "Z".repeat(2500) } }));
    const zCount = (userPromptOf().match(/Z/g) ?? []).length;
    expect(zCount).toBe(MAX_INPUT_LENGTH);
  });
});

describe("Refinement", () => {
  it("rejects an unknown refinement key with 400", async () => {
    const res = await POST(makeReq({ body: { businessIdea: DEFAULT_IDEA, refinement: "nonsense" } }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid refinement." });
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("injects the allowlisted refinement directive into the prompt", async () => {
    streamOnce("{}");
    const res = await POST(makeReq({ body: { businessIdea: DEFAULT_IDEA, refinement: "why" } }));
    expect(res.status).toBe(200);
    await collectStream(res);
    expect(userPromptOf()).toContain("sharpen and deepen the WHY");
  });
});

describe("Response cache", () => {
  it("serves an identical input from cache without calling the model twice", async () => {
    streamOnce(VALID_RESULT);

    const first = await POST(makeReq({}));
    await expect(collectStream(first)).resolves.toBe(VALID_RESULT);
    // Let the fire-and-forget cache write settle.
    await new Promise((r) => setTimeout(r, 0));

    const second = await POST(makeReq({}));
    await expect(collectStream(second)).resolves.toBe(VALID_RESULT);

    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });
});
