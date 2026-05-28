// Next.js boot-time hook. Runs once per server process on startup.
// Used here for fail-fast configuration invariants that would otherwise only
// surface on the first request (and might be missed in monitoring).
//
// Edge runtime cannot import from "node:*" or read Docker secret files, so the
// node-only checks are gated by NEXT_RUNTIME.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { assertTurnstileConfigValid } = await import("./lib/turnstile");
  assertTurnstileConfigValid();
}
