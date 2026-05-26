import { readRuntimeValue } from "@/lib/runtime-env"
import { TURNSTILE_ACTION } from "@/lib/turnstile-action"
import { logger } from "@/lib/logger"

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const VERIFY_TIMEOUT_MS = 5_000

interface TurnstileResponse {
  success?: boolean
  hostname?: string
  action?: string
  "error-codes"?: string[]
}

function getAllowedHostnames(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env.ALLOWED_ORIGINS?.trim()
  if (!raw) {
    return new Set()
  }
  const hosts = new Set<string>()
  for (const origin of raw.split(",")) {
    try {
      const url = new URL(origin.trim())
      hosts.add(url.hostname)
    } catch {
      // ignore invalid origin entries — lib/config already warns on these
    }
  }
  return hosts
}

export class TurnstileError extends Error {
  constructor(
    public readonly status: number,
    public readonly clientMessage: string,
    message: string,
  ) {
    super(message)
    this.name = "TurnstileError"
  }
}

export function getTurnstileSiteKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return readRuntimeValue("TURNSTILE_SITE_KEY", env)
}

function getTurnstileSecretKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return readRuntimeValue("TURNSTILE_SECRET_KEY", env)
}

function getTurnstileConfig(
  env: NodeJS.ProcessEnv = process.env,
): { siteKey: string; secretKey: string } | null {
  const siteKey = getTurnstileSiteKey(env)
  const secretKey = getTurnstileSecretKey(env)

  if (!siteKey && !secretKey) {
    return null
  }

  if (!siteKey || !secretKey) {
    throw new TurnstileError(503, "Service unavailable.", "Turnstile configuration is incomplete.")
  }

  return { siteKey, secretKey }
}

function isPublicProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" && env.DEPLOYMENT_MODE?.trim().toLowerCase() !== "local"
}

export async function verifyTurnstileToken(options: {
  token: unknown
  remoteIp?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const { token, remoteIp, env = process.env } = options
  const config = getTurnstileConfig(env)

  if (!config) {
    if (isPublicProduction(env)) {
      throw new TurnstileError(503, "Service unavailable.", "Turnstile is required in public production.")
    }

    // Turnstile is optional for development and explicit local deployments.
    return
  }

  const normalizedToken = typeof token === "string" ? token.trim() : ""
  if (!normalizedToken) {
    throw new TurnstileError(403, "Verification required.", "Missing Turnstile token.")
  }

  const body = new URLSearchParams({
    secret: config.secretKey,
    response: normalizedToken,
  })
  if (remoteIp) {
    body.set("remoteip", remoteIp)
  }

  let response: Response
  try {
    response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch {
    throw new TurnstileError(503, "Service unavailable.", "Turnstile verification request failed.")
  }

  if (!response.ok) {
    throw new TurnstileError(
      503,
      "Service unavailable.",
      `Turnstile verification returned HTTP ${response.status}.`,
    )
  }

  let payload: TurnstileResponse
  try {
    payload = (await response.json()) as TurnstileResponse
  } catch {
    throw new TurnstileError(503, "Service unavailable.", "Turnstile verification returned invalid JSON.")
  }

  if (!payload.success) {
    const errorCodes = payload["error-codes"] ?? []
    logger.warn("turnstile rejected", { codes: errorCodes.length ? errorCodes.join(",") : "no-error-codes" })
    throw new TurnstileError(403, "Verification failed.", "Turnstile rejected the submitted token.")
  }

  // Bind the token to the expected widget action — defends against a token
  // that was issued for a different widget on the same site (replay across
  // actions).
  if (payload.action !== TURNSTILE_ACTION) {
    logger.warn("turnstile action mismatch", { got: payload.action ?? "", expected: TURNSTILE_ACTION })
    throw new TurnstileError(403, "Verification failed.", "Turnstile token issued for a different action.")
  }

  // Bind the token to a hostname we serve. The token is signed by Cloudflare,
  // but the hostname binding makes sure a token captured from a different
  // site that happens to use the same secret cannot be replayed here.
  const allowedHostnames = getAllowedHostnames(env)
  if (allowedHostnames.size === 0 && isPublicProduction(env)) {
    throw new TurnstileError(503, "Service unavailable.", "Turnstile enabled but ALLOWED_ORIGINS has no valid hostnames.")
  }
  if (allowedHostnames.size > 0) {
    if (!payload.hostname || !allowedHostnames.has(payload.hostname)) {
      logger.warn("turnstile hostname mismatch", { got: payload.hostname ?? "", allowed: [...allowedHostnames].join(",") })
      throw new TurnstileError(403, "Verification failed.", "Turnstile token issued for a different hostname.")
    }
  }
}
