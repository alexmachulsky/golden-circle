/**
 * Public re-exports of validated runtime configuration.
 *
 * The actual env parsing lives in lib/env.ts. This module preserves the
 * existing import surface (`import { ALLOWED_ORIGINS, ... } from "@/lib/config"`)
 * so callers don't have to know about the schema layer.
 *
 * Tests that need to vary these values continue to vi.mock("@/lib/config")
 * and provide their own values; nothing in this module reaches into env
 * directly at request time.
 */

import { env } from "@/lib/env";

export const ALLOWED_ORIGINS: string[] = env.ALLOWED_ORIGINS;
export const RATE_LIMIT_PER_MIN: number = env.RATE_LIMIT_PER_MIN;
export const TRUSTED_IP_HEADER: string | null = env.TRUSTED_IP_HEADER;
