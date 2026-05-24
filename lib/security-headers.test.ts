import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, hasTurnstileConfig } from "./security-headers";

describe("security headers", () => {
  it("treats TURNSTILE_SITE_KEY_FILE as enabled Turnstile config", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      TURNSTILE_SITE_KEY_FILE: "/run/secrets/turnstile-site-key",
    };

    expect(
      hasTurnstileConfig(env),
    ).toBe(true);
  });

  it("adds the Turnstile origin to CSP when the site key comes from _FILE config", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      TURNSTILE_SITE_KEY_FILE: "/run/secrets/turnstile-site-key",
    };
    const csp = buildContentSecurityPolicy(env);

    expect(csp).toContain("https://challenges.cloudflare.com");
  });

  // A validly-shaped 16-byte base64 nonce (22 chars + "=="), matching what
  // proxy.ts generates at runtime; the CSP builder rejects malformed nonces.
  const NONCE = "ABCDEFGHIJKLMNOPQRSTUV==";

  it("allows React development tooling without weakening production script policy", () => {
    const devCsp = buildContentSecurityPolicy({ NODE_ENV: "development" }, NONCE);
    const prodCsp = buildContentSecurityPolicy({ NODE_ENV: "production" }, NONCE);

    expect(devCsp).toContain(`script-src 'self' 'nonce-${NONCE}' 'unsafe-eval'`);
    expect(prodCsp).toContain(`script-src 'self' 'nonce-${NONCE}'`);
    expect(prodCsp).not.toContain("'unsafe-eval'");
  });

  it("allows inline style tags in development while keeping nonce-only style tags in production", () => {
    const devCsp = buildContentSecurityPolicy({ NODE_ENV: "development" }, NONCE);
    const prodCsp = buildContentSecurityPolicy({ NODE_ENV: "production" }, NONCE);

    expect(devCsp).toContain("style-src 'self' 'unsafe-inline'");
    expect(devCsp).not.toContain(`style-src 'self' 'unsafe-inline' 'nonce-${NONCE}'`);
    expect(prodCsp).toContain(`style-src 'self' 'nonce-${NONCE}'`);
    expect(prodCsp).not.toContain("style-src 'self' 'unsafe-inline'");
  });

  it("keeps production style attributes allowed for Framer Motion compatibility", () => {
    const csp = buildContentSecurityPolicy({ NODE_ENV: "production" }, NONCE);

    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });
});
