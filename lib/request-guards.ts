/**
 * Request validation helpers for API routes.
 * Each guard throws HttpError on violation; callers convert it to a Response.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly clientMessage: string,
  ) {
    super(clientMessage);
    this.name = 'HttpError';
  }
}

/**
 * Rejects requests whose Content-Type is not application/json.
 * This forces a CORS preflight for cross-origin browser requests, which
 * defeats the "simple request" bypass used by malicious third-party pages.
 */
export function assertJsonContentType(req: Request): void {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
}

/**
 * Rejects requests whose Origin header is not in the allowed list.
 *
 * Browser requests always include an Origin header for cross-origin fetches
 * and same-origin POST requests. Server-to-server callers (e.g. test runners,
 * curl without an Origin header) are allowed through when NODE_ENV === 'test'
 * or when the Origin header is absent AND the environment is not production.
 */
export function assertAllowedOrigin(req: Request, allowed: string[]): void {
  const origin = req.headers.get('origin');

  // No Origin header — allow in test / dev, block in production.
  if (!origin) {
    if (process.env.NODE_ENV === 'production') {
      throw new HttpError(403, 'Forbidden.');
    }
    return;
  }

  if (!allowed.includes(origin)) {
    throw new HttpError(403, 'Forbidden.');
  }
}

/**
 * Reads the request body as JSON, rejecting payloads that exceed maxBytes.
 *
 * Two layers of defence:
 *  1. Content-Length header check (fast path — may be absent or spoofed).
 *  2. Actual byte count while reading the stream (always applied).
 */
export async function readJsonWithLimit(
  req: Request,
  maxBytes: number,
): Promise<unknown> {
  // Fast path: trust Content-Length if present.
  const clHeader = req.headers.get('content-length');
  if (clHeader) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > maxBytes) {
      throw new HttpError(413, 'Request body too large.');
    }
  }

  // Slow path: cap the actual read.
  const reader = req.body?.getReader();
  if (!reader) {
    throw new HttpError(400, 'Request body is missing.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Request body too large.');
    }
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0)),
  );

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}
