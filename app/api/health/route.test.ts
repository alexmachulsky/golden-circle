import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GET } from "./route";

const tempDirs: string[] = [];

function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = value;
}

function createSecretFile(name: string, value: string): string {
  const dir = mkdtempSync(join(tmpdir(), "golden-circle-health-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, value, "utf8");
  return filePath;
}

beforeEach(() => {
  setNodeEnv("test");
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY_FILE;
  delete process.env.TRUSTED_IP_HEADER;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SITE_KEY_FILE;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY_FILE;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("/api/health", () => {
  it("returns 200 with degraded status in production when Redis and proxy are not configured", async () => {
    setNodeEnv("production");
    process.env.GROQ_API_KEY = "groq-key";

    const res = await GET();

    // The app can still serve requests with in-memory rate limiting; only
    // the JSON status signals the missing optional infrastructure.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "degraded",
    });
  });

  it("accepts file-backed GROQ and Turnstile site key configuration", async () => {
    setNodeEnv("production");
    delete process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY_FILE = createSecretFile("groq-key.txt", "file-groq-key");
    process.env.TRUSTED_IP_HEADER = "x-client-ip";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
    delete process.env.TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SITE_KEY_FILE = createSecretFile("turnstile-site-key.txt", "site-key");
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
    });
  });
});
