/**
 * Rate limiting for /api/analyze.
 *
 * - Production uses Upstash Redis REST transactions so counters are shared
 *   across replicas and survive process restarts.
 * - Non-production falls back to an in-memory Map for local development and
 *   tests where a shared backend is unnecessary.
 * - Production also requires a trusted client-identity header; otherwise the
 *   request fails closed instead of collapsing all users into one bucket.
 */

interface Entry {
  count: number;
  resetAt: number;
}

interface UpstashResponseItem {
  error?: string;
  result?: unknown;
}

const LOCAL_KEY = "__local__";
const KEY_PREFIX = "rate-limit:v1";
const UPSTASH_TIMEOUT_MS = 2_000;
const store = new Map<string, Entry>();

export class RateLimitError extends Error {
  readonly clientMessage = "Service unavailable.";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "RateLimitError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Clears all counters. Intended for use in tests only. */
export function _resetStoreForTesting(): void {
  store.clear();
}

// Prune expired entries every 5 minutes to prevent unbounded growth in dev/test.
if (typeof setInterval !== "undefined") {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  if (typeof interval.unref === "function") {
    interval.unref();
  }
}

function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

function normalizeClientKey(rawValue: string | null): string {
  if (!rawValue) {
    return "";
  }

  return rawValue
    .split(",")[0]
    ?.trim() ?? "";
}

function getUpstashConfig(
  env: NodeJS.ProcessEnv = process.env,
): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url && !token) {
    return null;
  }

  if (!url || !token) {
    throw new RateLimitError(
      "Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together.",
    );
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

function checkRateLimitInMemory(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

async function incrementSharedCounter(
  key: string,
  windowMs: number,
  config: { url: string; token: string },
): Promise<number> {
  const response = await fetch(`${config.url}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["SET", `${KEY_PREFIX}:${key}`, "0", "PX", String(windowMs), "NX"],
      ["INCR", `${KEY_PREFIX}:${key}`],
      ["PTTL", `${KEY_PREFIX}:${key}`],
    ]),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new RateLimitError("Shared rate-limit backend request failed.", { cause: error });
  });

  if (!response.ok) {
    throw new RateLimitError(`Shared rate-limit backend returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as UpstashResponseItem[] | { error?: string };
  if (!Array.isArray(payload) || payload.length < 3) {
    throw new RateLimitError("Shared rate-limit backend returned an invalid response.");
  }

  for (const item of payload) {
    if (item?.error) {
      throw new RateLimitError(`Shared rate-limit backend error: ${item.error}`);
    }
  }

  const count = Number(payload[1]?.result);
  if (!Number.isFinite(count)) {
    throw new RateLimitError("Shared rate-limit backend returned a non-numeric counter.");
  }

  return count;
}

/**
 * Returns true if the request is within the allowed rate, false if it should
 * be rejected with 429.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<boolean> {
  const sharedConfig = getUpstashConfig();
  if (sharedConfig) {
    const count = await incrementSharedCounter(key, windowMs, sharedConfig);
    return count <= limit;
  }

  if (isProduction()) {
    throw new RateLimitError(
      "Distributed rate limiting is required in production. Configure Upstash Redis.",
    );
  }

  return checkRateLimitInMemory(key, { limit, windowMs });
}

/**
 * Derives a rate-limit key from the incoming request.
 *
 * When TRUSTED_IP_HEADER is set, only that header is read. The value must be
 * injected by a trusted reverse proxy after stripping any inbound copy.
 *
 * Outside production, the function falls back to a shared local key so the app
 * can run without a proxy or Redis during development and tests.
 */
export function getClientKey(req: Request, trustedIpHeader: string | null = null): string {
  const trustedValue = normalizeClientKey(
    trustedIpHeader ? req.headers.get(trustedIpHeader) : null,
  );

  if (trustedValue) {
    return trustedValue;
  }

  if (isProduction()) {
    if (!trustedIpHeader) {
      throw new RateLimitError("TRUSTED_IP_HEADER must be configured in production.");
    }

    throw new RateLimitError(
      `Missing trusted client identity header: ${trustedIpHeader}.`,
    );
  }

  return LOCAL_KEY;
}
