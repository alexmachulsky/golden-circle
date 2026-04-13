/**
 * Runtime configuration read from environment variables.
 * All values have safe development defaults.
 */

const raw = process.env.ALLOWED_ORIGINS ?? 'http://localhost:7001';

export const ALLOWED_ORIGINS: string[] = raw
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const rawLimit = process.env.RATE_LIMIT_PER_MIN;
export const RATE_LIMIT_PER_MIN: number = rawLimit ? parseInt(rawLimit, 10) : 20;

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
export const TRUSTED_IP_HEADER: string | null = process.env.TRUSTED_IP_HEADER ?? null;
