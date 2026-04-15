import Groq from "groq-sdk";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
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

const MODEL = "llama-3.3-70b-versatile";
const BODY_LIMIT_BYTES = 8 * 1024; // 8 KB - well above the 2000-char input maximum
const UPSTREAM_TIMEOUT_MS = 30_000;

function sanitizeInput(input: string): string {
  return input
    .replace(/<[^>]*>/g, "") // strip HTML/XML tags
    .trim()
    .slice(0, 2000);
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
  let clientKey = "__local__";

  // ── Guard 1: Content-Type ───────────────────────────────────────────────
  try {
    assertJsonContentType(req);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: ERROR_HEADERS });
    }
    throw err;
  }

  // ── Guard 2: Origin ─────────────────────────────────────────────────────
  try {
    assertAllowedOrigin(req, ALLOWED_ORIGINS);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: ERROR_HEADERS });
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
        { status: 429, headers: { ...ERROR_HEADERS, "Retry-After": "60" } },
      );
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.error("[analyze] rate-limit unavailable:", err.message);
      return Response.json({ error: err.clientMessage }, { status: 503, headers: ERROR_HEADERS });
    }

    throw err;
  }

  // ── Guard 4: Body size + parse ──────────────────────────────────────────
  let body: unknown;
  try {
    body = await readJsonWithLimit(req, BODY_LIMIT_BYTES);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: ERROR_HEADERS });
    }
    throw err;
  }

  // ── Guard 5: API key ────────────────────────────────────────────────────
  let apiKey: string | null;
  try {
    apiKey = readRuntimeValue("GROQ_API_KEY");
  } catch (err) {
    console.error("[analyze] failed to read GROQ_API_KEY:", err instanceof Error ? err.message : String(err));
    return Response.json({ error: "Service unavailable." }, { status: 500, headers: ERROR_HEADERS });
  }

  if (!apiKey) {
    console.error("[analyze] GROQ_API_KEY is not set");
    return Response.json({ error: "Service unavailable." }, { status: 500, headers: ERROR_HEADERS });
  }

  // ── Validate businessIdea ───────────────────────────────────────────────
  const rawBody = body as Record<string, unknown>;
  if (!rawBody.businessIdea || typeof rawBody.businessIdea !== "string") {
    return Response.json({ error: "businessIdea is required." }, { status: 400, headers: ERROR_HEADERS });
  }

  const sanitized = sanitizeInput(rawBody.businessIdea);
  if (sanitized.length < 50) {
    return Response.json(
      { error: "Please provide at least 50 characters describing your business idea." },
      { status: 400, headers: ERROR_HEADERS },
    );
  }

  // ── Guard 6: Human verification ────────────────────────────────────────
  try {
    await verifyTurnstileToken({
      token: rawBody.turnstileToken,
      remoteIp: clientKey === "__local__" ? null : clientKey,
    });
  } catch (err) {
    if (err instanceof TurnstileError) {
      return Response.json({ error: err.clientMessage }, { status: err.status, headers: ERROR_HEADERS });
    }
    throw err;
  }

  // ── Stream Groq response ────────────────────────────────────────────────
  const groq = new Groq({ apiKey });
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

      // Also abort if the client disconnects
      req.signal.addEventListener('abort', () => ac.abort(), { once: true });

      try {
        const stream = await groq.chat.completions.create(
          {
            model: MODEL,
            max_tokens: 1024,
            stream: true,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildUserPrompt(sanitized) },
            ],
          },
          { signal: ac.signal },
        );

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }

        controller.close();
      } catch (err: unknown) {
        console.error("[analyze] upstream error:", err instanceof Error ? err.message : String(err));
        const isTimeout =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
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

  return new Response(readable, { headers: STREAM_HEADERS });
}
