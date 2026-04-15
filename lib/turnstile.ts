import { readRuntimeValue } from "@/lib/runtime-env"

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const VERIFY_TIMEOUT_MS = 5_000

interface TurnstileResponse {
  success?: boolean
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
  const raw = env.TURNSTILE_SITE_KEY?.trim()
  return raw ? raw : null
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

export async function verifyTurnstileToken(options: {
  token: unknown
  remoteIp?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const { token, remoteIp, env = process.env } = options
  const config = getTurnstileConfig(env)

  if (!config) {
    // Turnstile is optional — if neither key is configured, skip verification.
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
    throw new TurnstileError(403, "Verification failed.", "Turnstile rejected the submitted token.")
  }
}
