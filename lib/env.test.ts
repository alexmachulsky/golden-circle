import { describe, expect, it, vi } from "vitest";

// loadEnv is not exported from lib/env.ts (which evaluates once at import).
// We re-implement the schema test by importing fresh modules with vi.resetModules.

async function loadFreshEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return await import("./env");
}

const KEYS = [
  "ALLOWED_ORIGINS",
  "RATE_LIMIT_PER_MIN",
  "TRUSTED_IP_HEADER",
  "DEPLOYMENT_MODE",
  "UPSTASH_REDIS_REST_URL",
];

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("lib/env", () => {
  it("uses sane defaults for an empty environment", async () => {
    const snapshot = snapshotEnv();
    try {
      const fresh = await loadFreshEnv(Object.fromEntries(KEYS.map((k) => [k, undefined])));
      expect(fresh.env.ALLOWED_ORIGINS).toEqual(["http://localhost:7001"]);
      expect(fresh.env.RATE_LIMIT_PER_MIN).toBe(20);
      expect(fresh.env.TRUSTED_IP_HEADER).toBeNull();
      expect(fresh.env.DEPLOYMENT_MODE).toBeNull();
      expect(fresh.env.UPSTASH_REDIS_REST_URL).toBeNull();
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("parses a comma-separated ALLOWED_ORIGINS list", async () => {
    const snapshot = snapshotEnv();
    try {
      const fresh = await loadFreshEnv({
        ALLOWED_ORIGINS: "http://localhost:7001, https://app.example.com",
      });
      expect(fresh.env.ALLOWED_ORIGINS).toEqual([
        "http://localhost:7001",
        "https://app.example.com",
      ]);
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("rejects ALLOWED_ORIGINS entries that aren't http(s) URLs", async () => {
    const snapshot = snapshotEnv();
    try {
      await expect(
        loadFreshEnv({ ALLOWED_ORIGINS: "ftp://files.example" }),
      ).rejects.toThrow(/ALLOWED_ORIGINS/);
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("rejects out-of-range RATE_LIMIT_PER_MIN", async () => {
    const snapshot = snapshotEnv();
    try {
      await expect(loadFreshEnv({ RATE_LIMIT_PER_MIN: "999" })).rejects.toThrow(
        /RATE_LIMIT_PER_MIN/,
      );
      await expect(loadFreshEnv({ RATE_LIMIT_PER_MIN: "0" })).rejects.toThrow(
        /RATE_LIMIT_PER_MIN/,
      );
      await expect(loadFreshEnv({ RATE_LIMIT_PER_MIN: "abc" })).rejects.toThrow(
        /RATE_LIMIT_PER_MIN/,
      );
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("rejects DEPLOYMENT_MODE values outside the enum", async () => {
    const snapshot = snapshotEnv();
    try {
      await expect(loadFreshEnv({ DEPLOYMENT_MODE: "staging" })).rejects.toThrow(
        /DEPLOYMENT_MODE/,
      );
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("rejects an http:// Upstash URL", async () => {
    const snapshot = snapshotEnv();
    try {
      await expect(
        loadFreshEnv({ UPSTASH_REDIS_REST_URL: "http://upstash.example" }),
      ).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("accepts a valid HTTPS Upstash URL", async () => {
    const snapshot = snapshotEnv();
    try {
      const fresh = await loadFreshEnv({
        UPSTASH_REDIS_REST_URL: "https://upstash.example",
      });
      expect(fresh.env.UPSTASH_REDIS_REST_URL).toBe("https://upstash.example");
    } finally {
      restoreEnv(snapshot);
    }
  });
});
