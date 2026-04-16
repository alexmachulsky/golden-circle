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

  const ok = groqConfigured && rateLimitConfigured && trustedProxyConfigured && turnstileConfigured;
  const status = ok ? "ok" : "degraded";

  return Response.json(
    {
      status,
      services: {
        groq: groqConfigured ? "configured" : "missing",
        rateLimit: rateLimitConfigured ? "configured" : "missing",
        trustedProxy: trustedProxyConfigured ? "configured" : "missing",
        turnstile: turnstileConfigured ? (turnstileEnabled ? "configured" : "disabled") : "missing",
      },
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
