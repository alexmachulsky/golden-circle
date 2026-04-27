import { z } from "zod";

/**
 * Runtime configuration schema.
 *
 * All process.env reads for configurable values flow through this module.
 * Values are validated once at first import; misconfiguration fails fast
 * with a single readable error rather than producing silent 500s deeper in
 * the request lifecycle.
 *
 * Secrets (GROQ_API_KEY, UPSTASH_REDIS_REST_TOKEN, TURNSTILE_SECRET_KEY)
 * intentionally stay out of this schema — they are read on demand via
 * lib/runtime-env so the file-backed (*_FILE) path keeps working.
 */

const originList = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() ?? "")
  .transform((value) => (value ? value.split(",") : []))
  .transform((entries) => entries.map((entry) => entry.trim()).filter(Boolean))
  .pipe(
    z
      .array(
        z.string().refine(
          (origin) => {
            try {
              const url = new URL(origin);
              return url.protocol === "http:" || url.protocol === "https:";
            } catch {
              return false;
            }
          },
          { message: "ALLOWED_ORIGINS entries must be valid http(s) URLs" },
        ),
      )
      .nonempty({ message: "ALLOWED_ORIGINS must list at least one origin" }),
  );

const rateLimit = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() ?? "")
  .transform((value, ctx) => {
    if (!value) return 20;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 600) {
      ctx.addIssue({
        code: "custom",
        message: `RATE_LIMIT_PER_MIN must be an integer between 1 and 600 (got "${value}")`,
      });
      return z.NEVER;
    }
    return parsed;
  });

const trustedIpHeader = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() || null);

const deploymentMode = z
  .string()
  .optional()
  .transform((raw) => raw?.trim().toLowerCase() ?? "")
  .pipe(z.enum(["", "local", "public"]))
  .transform((value) => (value === "" ? null : value));

const upstashUrl = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() || null)
  .superRefine((value, ctx) => {
    if (!value) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "UPSTASH_REDIS_REST_URL is not a valid URL" });
      return;
    }
    if (parsed.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "UPSTASH_REDIS_REST_URL must use HTTPS" });
    }
  });

const envSchema = z.object({
  ALLOWED_ORIGINS: originList,
  RATE_LIMIT_PER_MIN: rateLimit,
  TRUSTED_IP_HEADER: trustedIpHeader,
  DEPLOYMENT_MODE: deploymentMode,
  UPSTASH_REDIS_REST_URL: upstashUrl,
});

export type RuntimeEnv = z.infer<typeof envSchema>;

function loadEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  // Default ALLOWED_ORIGINS so unconfigured dev workstations still start.
  const candidate = {
    ALLOWED_ORIGINS: source.ALLOWED_ORIGINS ?? "http://localhost:7001",
    RATE_LIMIT_PER_MIN: source.RATE_LIMIT_PER_MIN,
    TRUSTED_IP_HEADER: source.TRUSTED_IP_HEADER,
    DEPLOYMENT_MODE: source.DEPLOYMENT_MODE,
    UPSTASH_REDIS_REST_URL: source.UPSTASH_REDIS_REST_URL,
  };

  const result = envSchema.safeParse(candidate);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "<root>";
      return `  - ${path}: ${issue.message}`;
    });
    throw new Error(
      `Invalid runtime configuration:\n${lines.join("\n")}\n` +
        `Check your environment variables (e.g. .env.local, docker-compose.yml, k8s/configmap.yaml).`,
    );
  }
  return result.data;
}

export const env: RuntimeEnv = loadEnv();
