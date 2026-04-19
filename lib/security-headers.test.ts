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
});
