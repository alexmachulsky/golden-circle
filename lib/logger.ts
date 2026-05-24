// Minimal dependency-free structured logger. Emits one JSON object per line so
// aggregators (Loki, CloudWatch, etc.) parse fields directly. Log error
// *messages* and outcomes only — never secret values or raw user input.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Short, collision-resistant id for correlating one request's log lines. */
export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
