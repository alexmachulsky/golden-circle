import { ALLOWED_ORIGINS } from "@/lib/config";

// Canonical public origin, used for metadataBase, OG tags, sitemap, robots, and
// JSON-LD. Prefer an explicit NEXT_PUBLIC_SITE_URL; otherwise fall back to the
// first allowed origin, then localhost for dev.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  ALLOWED_ORIGINS[0] ||
  "http://localhost:7001"
).replace(/\/$/, "");

export const SITE_NAME = "Golden Circle Analyzer";
export const SITE_DESCRIPTION =
  "Discover your business's WHY, HOW, and WHAT using Simon Sinek's Golden Circle framework — powered by AI engineered to produce real depth, not generic platitudes.";
