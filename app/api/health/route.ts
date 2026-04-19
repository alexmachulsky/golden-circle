import { readRuntimeValue } from "@/lib/runtime-env";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export async function GET() {
  let groqConfigured = false;
  let rateLimitConfigured = true;
  let trustedProxyConfigured = true;
  let turnstileConfigured = true;
  let turnstileEnabled = false;

  try {
    groqConfigured = Boolean(readRuntimeValue("GROQ_API_KEY"));
  } catch {
    // file-backed secret not accessible
  }

  if (process.env.NODE_ENV === "production") {
    try {
      rateLimitConfigured =
        Boolean(readRuntimeValue("UPSTASH_REDIS_REST_URL")) &&
        Boolean(readRuntimeValue("UPSTASH_REDIS_REST_TOKEN"));
    } catch {
      rateLimitConfigured = false;
    }

    trustedProxyConfigured = Boolean(process.env.TRUSTED_IP_HEADER?.trim());
  }

  try {
    const siteKey = getTurnstileSiteKey();
    const secretKey = readRuntimeValue("TURNSTILE_SECRET_KEY");
    turnstileEnabled = Boolean(siteKey || secretKey);
    turnstileConfigured = (!siteKey && !secretKey) || Boolean(siteKey && secretKey);
  } catch {
    turnstileConfigured = false;
  }

  const canServeRequests = groqConfigured && turnstileConfigured;
  const fullyConfigured =
    canServeRequests && rateLimitConfigured && trustedProxyConfigured;
  const status = fullyConfigured ? "ok" : "degraded";

  // Only expose aggregate status to unauthenticated callers.
  // Detailed service breakdown is logged server-side for operators.
  if (!canServeRequests || !fullyConfigured) {
    console.warn("[health] degraded:", {
      groq: groqConfigured ? "ok" : "missing",
      rateLimit: rateLimitConfigured ? "ok" : "missing",
      trustedProxy: trustedProxyConfigured ? "ok" : "missing",
      turnstile: turnstileConfigured ? (turnstileEnabled ? "ok" : "disabled") : "missing",
    });
  }

  return Response.json(
    { status },
    {
      // 503 only when the app cannot serve requests at all (Groq missing or
      // Turnstile misconfigured). Degraded optional services still return 200
      // so the Docker health check passes.
      status: canServeRequests ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
