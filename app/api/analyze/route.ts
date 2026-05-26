import OpenAI from "openai";
import { SYSTEM_PROMPT, buildUserPrompt, REFINEMENTS, type RefinementKey } from "@/lib/prompt";
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

// ── AI provider ───────────────────────────────────────────────────────────
// Groq (original provider) used the groq-sdk client + "llama-3.3-70b-versatile".
// We now call OpenRouter, which is OpenAI-compatible, via the official `openai`
// SDK pointed at OpenRouter's baseURL. (The groq-sdk hardcodes the path
// "/openai/v1/chat/completions", which does not match OpenRouter's
// "/api/v1/chat/completions", so it cannot be repointed by baseURL alone.)
// The streaming chunk shape is identical, so the rest of the route is unchanged.
// `:free` variant — same model weights, billed at $0 (subject to OpenRouter's
// free-tier daily request cap). Drop the `:free` suffix to use the paid variant.
const MODEL = "openai/gpt-oss-120b:free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const BODY_LIMIT_BYTES = 8 * 1024; // 8 KB - well above the MAX_INPUT_LENGTH-char input maximum
// gpt-oss-120b is a large, comparatively slow model: a full Golden Circle
// generation measures ~25-30s. The previous 30s budget (tuned for Groq's fast
// Llama model) sat right at that edge, so slower generations were aborted
// mid-stream and the client saw truncated JSON ("Could not parse the AI
// response"). 60s gives comfortable headroom above the observed worst case.
const UPSTREAM_TIMEOUT_MS = 60_000;

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
  "Content-Type": "text/plain; charset=utf-8",
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
  if (cached && !cached.includes("__ERROR__")) {
    logger.info("analyze", { reqId, cache: "hit", status: 200 });
    return new Response(cached, { headers: streamHeaders });
  }
  logger.info("analyze", { reqId, cache: "miss", status: 200 });

  // ── Stream the OpenRouter (OpenAI-compatible) response ──────────────────
  // Groq (original): const client = new Groq({ apiKey });
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    // Optional OpenRouter attribution headers (used for their dashboard ranking).
    defaultHeaders: {
      "HTTP-Referer": ALLOWED_ORIGINS[0] ?? "http://localhost:7001",
      "X-Title": "Golden Circle Analyzer",
    },
  });
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

      // Also abort if the client disconnects
      req.signal.addEventListener('abort', () => ac.abort(), { once: true });

      try {
        const stream = await client.chat.completions.create(
          {
            model: MODEL,
            // The schema (WHY + 4 HOW + 3 WHAT + notes, each 1-2 sentences) needs
            // well over 1024 tokens; too low truncates the JSON mid-object and the
            // client's parseAnalysis then fails ("Could not parse the AI response").
            // gpt-oss-120b is markedly more verbose than the prior Llama model and
            // may also spend tokens on reasoning, so we give generous headroom.
            max_tokens: 4096,
            stream: true,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildUserPrompt(sanitized, refinement) },
            ],
          },
          { signal: ac.signal },
        );

        let accumulated = "";
        let checkedPrefix = false;
        let fullResponse = "";

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            // Guard against a prompt-injected LLM response that starts with
            // the error sentinel.  Buffer until we see the first '{' (start of
            // the JSON object) or until we have enough bytes to be certain the
            // sentinel is absent.  Check the entire preamble before '{' so a
            // sentinel padded with whitespace or split across chunks is still
            // caught — but only within that pre-JSON window to avoid false
            // positives on JSON content that mentions the literal string.
            if (!checkedPrefix) {
              accumulated += text;
              const braceIndex = accumulated.indexOf("{");
              // Wait for the JSON to start, or for enough bytes that a sentinel
              // beginning within the first 64 can't be split across the cutoff
              // (the sentinel itself is 9 chars).
              const ready = braceIndex !== -1 || accumulated.length >= 64 + "__ERROR__".length;
              if (ready) {
                checkedPrefix = true;
                // The preamble is everything before the first '{', or the
                // entire accumulated buffer if no '{' has appeared yet.
                const preamble =
                  braceIndex !== -1 ? accumulated.slice(0, braceIndex) : accumulated;
                if (/^[\s\S]*?__ERROR__/.test(preamble)) {
                  // LLM was injected into emitting the error prefix — reject.
                  controller.enqueue(
                    encoder.encode("__ERROR__Analysis failed. Please try again."),
                  );
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(accumulated));
                fullResponse += accumulated;
                accumulated = "";
              }
            } else {
              controller.enqueue(encoder.encode(text));
              fullResponse += text;
            }
          }
        }
        // Flush any buffered prefix bytes for very short responses. Use the
        // same `includes` semantics as the buffered branch above so a short
        // injected response with leading whitespace before the sentinel is
        // still rejected.
        if (accumulated) {
          if (accumulated.includes("__ERROR__")) {
            controller.enqueue(encoder.encode("__ERROR__Analysis failed. Please try again."));
          } else {
            controller.enqueue(encoder.encode(accumulated));
            fullResponse += accumulated;
          }
        }

        controller.close();

        // Cache the assembled response so the next identical request skips
        // the LLM entirely. setCachedAnalysis filters error sentinels and
        // non-JSON payloads itself.
        if (fullResponse) {
          setCachedAnalysis(cacheKey, fullResponse).catch((err) => {
            logger.warn("cache write failed", { reqId, err: err instanceof Error ? err.message : String(err) });
          });
        }
      } catch (err: unknown) {
        logger.error("upstream error", { reqId, err: err instanceof Error ? err.message : String(err) });
        // The OpenAI SDK raises APIUserAbortError (not AbortError) when the
        // signal fires, so match on a broader set of names/messages.
        const isTimeout =
          err instanceof Error &&
          (/abort|timeout/i.test(err.name) || /abort|timed?\s*out/i.test(err.message));
        const clientMsg = isTimeout
          ? "__ERROR__Request timed out. Please try again."
          : "__ERROR__Analysis failed. Please try again.";
        controller.enqueue(encoder.encode(clientMsg));
        controller.close();
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return new Response(readable, { headers: streamHeaders });
}
