import { createHash } from "node:crypto";
import { readRuntimeValue } from "@/lib/runtime-env";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { parseAnalysis } from "@/lib/validate-analysis";

/**
 * Identical-input cache for /api/analyze.
 *
 * Saves a Groq call (and ~3 seconds + paid tokens) when the same business
 * idea is analyzed twice within the TTL. Cache keys are sha256(sanitizedInput)
 * so the user-facing input length / wording determines the hit rate.
 *
 * Backends:
 *   - DEPLOYMENT_MODE=local or non-production: in-memory Map (per-process).
 *   - Production with Upstash Redis configured: shared via REST.
 *   - Production without Upstash: caching is disabled — falls through to Groq.
 */

const KEY_PREFIX = "analyze:v1";
const TTL_SECONDS = 60 * 60; // 1 hour
const UPSTASH_TIMEOUT_MS = 2_000;

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

/** For tests only. */
export function _resetCacheForTesting(): void {
  memory.clear();
}

if (typeof setInterval !== "undefined") {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of memory) {
      if (now >= e.expiresAt) memory.delete(k);
    }
  }, 5 * 60 * 1000);
  if (typeof interval.unref === "function") interval.unref();
}

export function computeCacheKey(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isCachableResponse(value: string): boolean {
  // Never cache error sentinels.
  if (value.includes("__ERROR__")) return false;
  // Only cache a response that actually parses into a valid AnalysisResult —
  // the same check the client runs. A truncated stream (cut off mid-object) or
  // a schema-violating response would otherwise be cached and re-served for the
  // full TTL, turning a transient glitch into a sticky "Could not parse the AI
  // response" error for every identical request.
  try {
    parseAnalysis(value);
    return true;
  } catch {
    return false;
  }
}

interface UpstashConfig {
  url: string;
  token: string;
}

function getUpstashConfig(): UpstashConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  if (!url) return null;
  let token: string | null;
  try {
    token = readRuntimeValue("UPSTASH_REDIS_REST_TOKEN");
  } catch {
    return null;
  }
  if (!token) return null;
  return { url, token };
}

async function upstashCommand<T = unknown>(
  config: UpstashConfig,
  command: string[],
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("cache upstash request failed", { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (!response.ok) {
    logger.warn("cache upstash non-ok", { status: response.status });
    return null;
  }
  try {
    const payload = (await response.json()) as { result?: T; error?: string };
    if (payload.error) {
      logger.warn("cache upstash error", { err: String(payload.error) });
      return null;
    }
    return (payload.result ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function getCachedAnalysis(key: string): Promise<string | null> {
  const config = getUpstashConfig();
  if (config) {
    const result = await upstashCommand<string | null>(config, [
      "GET",
      `${KEY_PREFIX}:${key}`,
    ]);
    return typeof result === "string" ? result : null;
  }

  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export async function setCachedAnalysis(key: string, value: string): Promise<void> {
  if (!isCachableResponse(value)) return;

  const config = getUpstashConfig();
  if (config) {
    await upstashCommand(config, [
      "SET",
      `${KEY_PREFIX}:${key}`,
      value,
      "EX",
      String(TTL_SECONDS),
    ]);
    return;
  }

  memory.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}
