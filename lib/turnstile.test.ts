import { describe, it, expect } from "vitest";
import { assertTurnstileConfigValid } from "./turnstile";

function envWith(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...partial } as NodeJS.ProcessEnv;
}

describe("assertTurnstileConfigValid", () => {
  it("passes when both keys are unset (Turnstile disabled)", () => {
    expect(() => assertTurnstileConfigValid(envWith({}))).not.toThrow();
  });

  it("passes when both keys are set", () => {
    expect(() =>
      assertTurnstileConfigValid(
        envWith({ TURNSTILE_SITE_KEY: "site-x", TURNSTILE_SECRET_KEY: "secret-x" }),
      ),
    ).not.toThrow();
  });

  it("throws when only TURNSTILE_SITE_KEY is set", () => {
    expect(() =>
      assertTurnstileConfigValid(envWith({ TURNSTILE_SITE_KEY: "site-only" })),
    ).toThrow(/both set or both unset/);
  });

  it("throws when only TURNSTILE_SECRET_KEY is set", () => {
    expect(() =>
      assertTurnstileConfigValid(envWith({ TURNSTILE_SECRET_KEY: "secret-only" })),
    ).toThrow(/both set or both unset/);
  });
});
