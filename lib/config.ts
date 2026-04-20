/**
 * Runtime configuration read from environment variables.
 * All values have safe development defaults.
 */

export type DeploymentMode = "local" | "public";

export function getDeploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  return env.DEPLOYMENT_MODE?.trim().toLowerCase() === "public" ? "public" : "local";
}

export const DEPLOYMENT_MODE: DeploymentMode = getDeploymentMode();

const raw = process.env.ALLOWED_ORIGINS ?? 'http://localhost:7001';

export const ALLOWED_ORIGINS: string[] = raw
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  .filter((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      console.warn(`[config] Ignoring invalid origin: ${origin}`);
      return false;
    }
  });

export const EXPECTED_TURNSTILE_HOSTNAMES: string[] = Array.from(
  new Set(
    ALLOWED_ORIGINS.map((origin) => new URL(origin).hostname.toLowerCase()),
  ),
);

const rawLimit = process.env.RATE_LIMIT_PER_MIN;
const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : NaN;
const MAX_RATE_LIMIT = 600;
export const RATE_LIMIT_PER_MIN: number = (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= MAX_RATE_LIMIT)
  ? parsedLimit
  : 20;

/**
 * The name of the request header that carries the authoritative client IP,
 * as injected by a trusted reverse proxy (e.g. ALB, nginx).
 *
 * Production requests fail closed when this header is unset or absent because
 * the app must not collapse all users into one shared rate-limit bucket.
 * Non-production requests fall back to a local development bucket instead.
 *
 * The reverse proxy MUST strip inbound copies of this header from untrusted
 * clients before appending its own so the value cannot be spoofed.
 */
export function getTrustedIpHeader(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TRUSTED_IP_HEADER?.trim().toLowerCase() ?? null;
}

export const TRUSTED_IP_HEADER: string | null = getTrustedIpHeader();
