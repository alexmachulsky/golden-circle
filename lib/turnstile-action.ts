// Action label that tags tokens issued for /api/analyze. Used by both the
// client widget (when rendering the challenge) and the server verifier (to
// reject tokens issued for a different widget action). Kept in its own
// module so the client bundle does not pull in node:fs from runtime-env.
export const TURNSTILE_ACTION = "analyze";
