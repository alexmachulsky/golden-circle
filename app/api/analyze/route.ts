import { REFINEMENTS, type RefinementKey } from "@/lib/prompt";
import { ALLOWED_ORIGINS, RATE_LIMIT_PER_MIN, TRUSTED_IP_HEADER } from "@/lib/config";
import {
  HttpError,
  assertAllowedOrigin,
  assertJsonContentType,
  readJsonWithLimit,
} from "@/lib/request-guards";
import { RateLimitError, checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { readRuntimeValue } from "@/lib/runtime-env";
import { TurnstileError, verifyTurnstileToken } from "@/lib/turnstile";
import {
  computeCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
} from "@/lib/analyze-cache";

import { MIN_INPUT_LENGTH, MAX_INPUT_LENGTH } from "@/lib/constants";
import { logger, newRequestId } from "@/lib/logger";
import { getModel } from "@/lib/agent/llm";
import { runAnalysis } from "@/lib/agent/graph";
import { encodeEvent, type AgentEvent } from "@/lib/agent/events";
import { sanitizeAnalysis } from "@/lib/validate-analysis";

// ── AI provider ───────────────────────────────────────────────────────────
// The analysis runs through the agent reflection loop (AI SDK structured
// output) and is streamed to the client as typed ndjson events. getModel() and
// runAnalysis() handle LLM invocation; the route preserves all guards, caching,
// and error handling.
const BODY_LIMIT_BYTES = 8 * 1024; // 8 KB - well above the MAX_INPUT_LENGTH-char input maximum
// The reflection loop makes up to three model calls (analyze + critique +
// refine), so the per-request budget is larger than the single-call era.
const UPSTREAM_TIMEOUT_MS = 90_000;

function sanitizeInput(input: string): string {
  return input
    .replace(/<[^>]*>?/g, "")                              // strip HTML/XML tags (incl. unclosed)
    .replace(/[\uFF1C\uFF1E\u2039\u203A\u276E\u276F]/g, "") // strip Unicode angle-bracket lookalikes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, "") // strip control & bidi chars
    .trim()
    .slice(0, MAX_INPUT_LENGTH);
}

const ERROR_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(req: Request) {
  const reqId = newRequestId();
  const errorHeaders = { ...ERROR_HEADERS, "X-Request-Id": reqId };
  const streamHeaders = { ...STREAM_HEADERS, "X-Request-Id": reqId };
  let clientKey = "__local__";

  // ── Guard 1: Content-Type ───────────────────────────────────────────────
  try {
    assertJsonContentType(req);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: errorHeaders });
    }
    throw err;
  }

  // ── Guard 2: Origin ─────────────────────────────────────────────────────
  try {
    assertAllowedOrigin(req, ALLOWED_ORIGINS);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: errorHeaders });
    }
    throw err;
  }

  // ── Guard 3: Rate limit ─────────────────────────────────────────────────
  try {
    clientKey = getClientKey(req, TRUSTED_IP_HEADER);
    const allowed = await checkRateLimit(clientKey, {
      limit: RATE_LIMIT_PER_MIN,
      windowMs: 60_000,
    });

    if (!allowed) {
      return Response.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { ...errorHeaders, "Retry-After": "60" } },
      );
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      logger.error("rate-limit unavailable", { reqId, err: err.message });
      return Response.json({ error: err.clientMessage }, { status: 503, headers: errorHeaders });
    }

    throw err;
  }

  // ── Guard 4: Body size + parse ──────────────────────────────────────────
  let body: unknown;
  try {
    body = await readJsonWithLimit(req, BODY_LIMIT_BYTES);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: errorHeaders });
    }
    throw err;
  }

  // ── Guard 5: API key ────────────────────────────────────────────────────
  let apiKey: string | null;
  try {
    // Groq (original): apiKey = readRuntimeValue("GROQ_API_KEY");
    apiKey = readRuntimeValue("OPENROUTER_API_KEY");
  } catch (err) {
    logger.error("failed to read OPENROUTER_API_KEY", { reqId, err: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Service unavailable." }, { status: 500, headers: errorHeaders });
  }

  if (!apiKey) {
    logger.error("OPENROUTER_API_KEY is not set", { reqId });
    return Response.json({ error: "Service unavailable." }, { status: 500, headers: errorHeaders });
  }

  // ── Validate businessIdea ───────────────────────────────────────────────
  const rawBody = body as Record<string, unknown>;
  if (!rawBody.businessIdea || typeof rawBody.businessIdea !== "string") {
    return Response.json({ error: "businessIdea is required." }, { status: 400, headers: errorHeaders });
  }

  const rawInput = rawBody.businessIdea.trim();
  if (rawInput.length < MIN_INPUT_LENGTH) {
    return Response.json(
      { error: `Please provide at least ${MIN_INPUT_LENGTH} characters describing your business idea.` },
      { status: 400, headers: errorHeaders },
    );
  }

  const sanitized = sanitizeInput(rawBody.businessIdea);

  // ── Optional refinement focus (allowlisted key, never free text) ────────
  let refinement: RefinementKey | null = null;
  if (rawBody.refinement != null) {
    if (typeof rawBody.refinement !== "string" || !(rawBody.refinement in REFINEMENTS)) {
      return Response.json({ error: "Invalid refinement." }, { status: 400, headers: errorHeaders });
    }
    refinement = rawBody.refinement as RefinementKey;
  }

  // ── Guard 6: Human verification ────────────────────────────────────────
  if (rawBody.turnstileToken != null && typeof rawBody.turnstileToken !== "string") {
    return Response.json({ error: "turnstileToken must be a string." }, { status: 400, headers: errorHeaders });
  }
  try {
    await verifyTurnstileToken({
      token: rawBody.turnstileToken,
      remoteIp: clientKey === "__local__" ? null : clientKey,
    });
  } catch (err) {
    if (err instanceof TurnstileError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: errorHeaders });
    }
    throw err;
  }

  // ── Cache lookup: identical sanitized input within the TTL ──────────────
  // A refinement varies the prompt, so it must vary the cache key too —
  // otherwise a refine request would return the un-refined cached result.
  const cacheKey = computeCacheKey(refinement ? `${sanitized}::refine=${refinement}` : sanitized);
  let cached: string | null = null;
  try {
    cached = await getCachedAnalysis(cacheKey);
  } catch (err) {
    // Cache failures must never block the request — fall through to the LLM.
    logger.warn("cache lookup failed", { reqId, err: err instanceof Error ? err.message : String(err) });
  }
  if (cached) {
    logger.info("analyze", { reqId, cache: "hit", status: 200 });
    // Cache only ever holds a validated analysis JSON; re-emit it as a final event.
    const event = encodeEvent({ type: "final", result: JSON.parse(cached) });
    return new Response(event, { headers: streamHeaders });
  }
  logger.info("analyze", { reqId, cache: "miss", status: 200 });

  // ── Run the agent reflection loop, streaming typed ndjson events ──────────
  const model = getModel(apiKey);
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
      req.signal.addEventListener("abort", () => ac.abort(), { once: true });

      // Forward events to the client; sanitize any analysis payload (defense in
      // depth) before it leaves the server.
      const emit = (event: AgentEvent) => {
        const safe: AgentEvent =
          event.type === "final" || event.type === "draft"
            ? { ...event, result: sanitizeAnalysis(event.result) }
            : event;
        controller.enqueue(encoder.encode(encodeEvent(safe)));
      };

      try {
        const analysis = await runAnalysis(
          { mode: "idea", text: sanitized, refinement },
          { model, signal: ac.signal, emit },
        );
        // Cache the validated, sanitized result so the next identical request
        // skips the LLM. setCachedAnalysis filters non-JSON payloads itself.
        setCachedAnalysis(cacheKey, JSON.stringify(sanitizeAnalysis(analysis))).catch((err) => {
          logger.warn("cache write failed", { reqId, err: err instanceof Error ? err.message : String(err) });
        });
        controller.close();
      } catch (err: unknown) {
        // runAnalysis already emitted a typed `error` event for the client.
        logger.error("analyze graph error", { reqId, err: err instanceof Error ? err.message : String(err) });
        controller.close();
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return new Response(readable, { headers: streamHeaders });
}
