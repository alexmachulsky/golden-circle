import { isIP } from "node:net";
import { readRuntimeValue } from "@/lib/runtime-env"

/**
 * Rate limiting for /api/analyze.
 *
 * - Production uses Upstash Redis REST transactions so counters are shared
 *   across replicas and survive process restarts.
 * - Public production deployments fail closed unless both the shared backend
 *   and the trusted client-identity header are configured.
 * - Local single-container production deployments can opt into the in-memory
 *   limiter by setting DEPLOYMENT_MODE=local.
 * - Non-production falls back to an in-memory Map for local development and
 *   tests where a shared backend is unnecessary.
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

function isLocalProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProduction(env) && env.DEPLOYMENT_MODE?.trim().toLowerCase() === "local";
}

// Strict IP parser: validates with net.isIP() instead of a regex so values like
// "999.999.999.999", "deadbeef", or ":::::::::" are rejected. Strips optional
// port suffix and IPv6 brackets so the limiter keys on the address itself,
// never on a per-connection ephemeral port.
function normalizeClientKey(rawValue: string | null): string {
  if (!rawValue) {
    return "";
  }

  // x-forwarded-for is a comma-separated list: "client, proxy1, proxy2".
  // We use the rightmost value (added by our ingress controller, not the client)
  // so it cannot be spoofed by injecting extra entries at the front.
  const candidate = rawValue.split(",").at(-1)?.trim() ?? "";
  if (!candidate) {
    return "";
  }

  // Bracketed IPv6 form: "[::1]" or "[::1]:8080"
  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end === -1) {
      return "";
    }
    const inner = candidate.slice(1, end);
    const tail = candidate.slice(end + 1);
    if (tail !== "" && !/^:\d+$/.test(tail)) {
      return "";
    }
    return isIP(inner) === 6 ? inner : "";
  }

  // Plain form: validate as-is first. Handles bare IPv4 ("1.2.3.4") and
  // bare IPv6 ("::1") — IPv6 addresses contain colons, so we must not
  // strip suffixes blindly.
  if (isIP(candidate)) {
    return candidate;
  }

  // IPv4 with port ("1.2.3.4:5678"): exactly one colon, digits-only port.
  const firstColon = candidate.indexOf(":");
  const lastColon = candidate.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon) {
    const host = candidate.slice(0, firstColon);
    const port = candidate.slice(firstColon + 1);
    if (/^\d+$/.test(port) && isIP(host) === 4) {
      return host;
    }
  }

  return "";
}

function getUpstashConfig(
  env: NodeJS.ProcessEnv = process.env,
): { url: string; token: string } | null {
  let url: string | null
  let token: string | null

  try {
    url = readRuntimeValue("UPSTASH_REDIS_REST_URL", env)
    token = readRuntimeValue("UPSTASH_REDIS_REST_TOKEN", env)
  } catch (error: unknown) {
    throw new RateLimitError("Failed to read shared rate-limit backend configuration.", { cause: error })
  }

  if (!url && !token) {
    return null;
  }

  if (!url || !token) {
    throw new RateLimitError(
      "Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together.",
    );
  }

  // Enforce HTTPS — prevents the bearer token from being transmitted in plaintext
  // and blocks SSRF to a http:// endpoint controlled by an attacker.
  if (!url.startsWith("https://")) {
    throw new RateLimitError("UPSTASH_REDIS_REST_URL must use HTTPS.");
  }

  // Block private/internal IP ranges to prevent SSRF via a misconfigured URL.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RateLimitError("UPSTASH_REDIS_REST_URL is not a valid URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new RateLimitError("UPSTASH_REDIS_REST_URL must not point to a private network address.");
  }

  return {
    url: parsed.origin,
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

  if (isProduction() && !isLocalProductionDeployment()) {
    throw new RateLimitError("Shared rate-limit backend is required in production.");
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
 * can run without a proxy during development and tests.
 */
export function getClientKey(req: Request, trustedIpHeader: string | null = null): string {
  if (isProduction() && !isLocalProductionDeployment() && !trustedIpHeader) {
    throw new RateLimitError("Trusted client identity is required in public production deployments.");
  }

  const trustedValue = normalizeClientKey(
    trustedIpHeader ? req.headers.get(trustedIpHeader) : null,
  );

  if (trustedValue) {
    return trustedValue;
  }

  if (isProduction() && trustedIpHeader) {
    // Header name is configured but absent or invalid — fail closed so requests
    // that bypass the reverse proxy are rejected.
    throw new RateLimitError(
      `Missing trusted client identity header: ${trustedIpHeader}.`,
    );
  }

  // No trusted proxy configured: fall back to a shared in-process bucket.
  return LOCAL_KEY;
}
