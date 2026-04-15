import { readFileSync } from "node:fs"

/**
 * Reads a runtime configuration value from either NAME or NAME_FILE.
 * Direct environment values win; file-backed values support container secrets.
 */
export function readRuntimeValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const filePath = env[`${name}_FILE`]?.trim()
  if (filePath) {
    const fileValue = readFileSync(filePath, "utf8").trim()
    if (fileValue) {
      return fileValue
    }
  }

  const directValue = env[name]?.trim()
  return directValue ? directValue : null
}
