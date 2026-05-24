import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, newRequestId } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line with ts, level, msg and merged fields", () => {
    logger.info("analyze", { reqId: "abc12345", cache: "hit", ms: 12 });
    expect(console.log).toHaveBeenCalledTimes(1);
    const line = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("analyze");
    expect(parsed.reqId).toBe("abc12345");
    expect(parsed.cache).toBe("hit");
    expect(parsed.ms).toBe(12);
    expect(typeof parsed.ts).toBe("string");
  });

  it("routes warn to console.warn and error to console.error", () => {
    logger.warn("careful");
    logger.error("boom");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("newRequestId returns an 8-char lowercase hex id", () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}$/);
  });
});
