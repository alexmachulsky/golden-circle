const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// Only allow standard base64 characters — no quotes, whitespace, or control chars
// that could escape a CSP directive.
const SAFE_NONCE_RE = /^[A-Za-z0-9+/=]+$/;

export function hasTurnstileConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() || env.TURNSTILE_SITE_KEY_FILE?.trim());
}

/**
 * Build the Content-Security-Policy header value.
 *
 * When a `nonce` is provided (per-request, from middleware):
 *  - `style-src` uses the nonce so only Next.js-managed <style> elements are
 *    allowed; `'unsafe-inline'` is removed for that directive.
 *  - `style-src-attr` keeps `'unsafe-inline'` so that inline `style=`
 *    attributes (e.g. Framer Motion animation props) continue to work.
 *  - `script-src` also receives the nonce so Next.js can attach it to any
 *    inline framework scripts it injects during SSR.
 *
 * Without a nonce (static context such as `next.config.ts` headers()):
 *  - Falls back to `'unsafe-inline'` for style-src (no regressions).
 */
export function buildContentSecurityPolicy(
  env: NodeJS.ProcessEnv = process.env,
  nonce?: string,
): string {
  const hasTurnstile = hasTurnstileConfig(env);
  const safeNonce = nonce && SAFE_NONCE_RE.test(nonce) ? nonce : undefined;
  const scriptNonce = safeNonce ? ` 'nonce-${safeNonce}'` : "";

  const directives = [
    "default-src 'self'",
    `script-src 'self'${scriptNonce}${hasTurnstile ? ` ${TURNSTILE_ORIGIN}` : ""}`,
    // Nonce-based <style> elements; 'unsafe-inline' removed when nonce is active.
    safeNonce
      ? `style-src 'self' 'nonce-${safeNonce}'`
      : "style-src 'self' 'unsafe-inline'",
    // Allow inline style= attributes (Framer Motion, React style props).
    // style-src-attr is a CSP3 directive; browsers that don't support it fall
    // back to style-src, which already has the nonce.
    ...(safeNonce ? ["style-src-attr 'unsafe-inline'"] : []),
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self'${hasTurnstile ? ` ${TURNSTILE_ORIGIN}` : ""}`,
    `frame-src 'self'${hasTurnstile ? ` ${TURNSTILE_ORIGIN}` : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  return directives.join("; ");
}
