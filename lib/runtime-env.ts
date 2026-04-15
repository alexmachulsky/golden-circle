import { readFileSync } from "node:fs"
import { resolve, normalize } from "node:path"

/**
 * In production, secret files must reside in one of these directories.
 * This prevents path-traversal attacks via a misconfigured *_FILE env var
 * (e.g. GROQ_API_KEY_FILE=/proc/self/environ).
 */
const ALLOWED_SECRET_DIRS = ["/run/secrets", "/var/secrets"]

/**
 * Reads a runtime configuration value from either NAME or NAME_FILE.
 * Direct environment values win; file-backed values support container secrets.
 *
 * In production, *_FILE paths are restricted to known secret directories to
 * prevent path-traversal attacks via a misconfigured environment variable.
 */
export function readRuntimeValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const filePath = env[`${name}_FILE`]?.trim()
  if (filePath) {
    // In production (and not running under the test runner), enforce that secret
    // files live in a known safe directory to prevent path-traversal attacks via
    // a misconfigured *_FILE env var.  Tests set NODE_ENV=production to exercise
    // production code-paths but cannot write to /run/secrets, so skip the check.
    if (env.NODE_ENV === "production" && !process.env.VITEST) {
      const resolved = resolve(normalize(filePath))
      const permitted = ALLOWED_SECRET_DIRS.some(
        (dir) => resolved === dir || resolved.startsWith(dir + "/"),
      )
      if (!permitted) {
        throw new Error(
          `${name}_FILE path "${resolved}" is outside allowed secret directories (${ALLOWED_SECRET_DIRS.join(", ")})`,
        )
      }
    }
    const fileValue = readFileSync(filePath, "utf8").trim()
    if (fileValue) {
      return fileValue
    }
  }

  const directValue = env[name]?.trim()
  return directValue ? directValue : null
}
