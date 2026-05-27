import type { AnalysisResult } from "@/types";
import { parseAnalysis } from "@/lib/validate-analysis";

const HASH_PREFIX = "#data=";
// Scheme marker for gzip-compressed payloads. The "." is not in the base64url
// alphabet, so legacy uncompressed links (raw base64url, no marker) stay
// unambiguously decodable.
const COMPRESSED_MARKER = "v1.";
const MAX_ENCODED_LENGTH = 8 * 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}

function fromBase64Url(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

const supportsCompression =
  typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function gzip(input: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(input));
  void writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

// Encode a result into the hash payload (without the #data= prefix). Prefers
// gzip (markedly smaller, so more results fit the budget); falls back to raw
// base64url when CompressionStream is unavailable.
export async function encodeAnalysisForUrl(result: AnalysisResult): Promise<string> {
  const json = JSON.stringify(result);
  if (supportsCompression) {
    try {
      return `${COMPRESSED_MARKER}${bytesToBase64Url(await gzip(json))}`;
    } catch {
      // Fall through to uncompressed encoding.
    }
  }
  return toBase64Url(json);
}

// Build a shareable URL, or null if the encoded payload exceeds the hash budget
// (so the caller can tell the user instead of silently producing a broken link).
export async function tryBuildShareUrl(
  result: AnalysisResult,
  origin: string,
  pathname: string,
): Promise<string | null> {
  const payload = await encodeAnalysisForUrl(result);
  if (payload.length > MAX_ENCODED_LENGTH) return null;
  return `${origin}${pathname}${HASH_PREFIX}${payload}`;
}

export async function decodeAnalysisFromHash(hash: string): Promise<AnalysisResult | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const payload = hash.slice(HASH_PREFIX.length);
  if (!payload || payload.length > MAX_ENCODED_LENGTH) return null;

  let json: string;
  try {
    json = payload.startsWith(COMPRESSED_MARKER)
      ? await gunzip(base64UrlToBytes(payload.slice(COMPRESSED_MARKER.length)))
      : fromBase64Url(payload);
  } catch {
    return null;
  }

  try {
    return parseAnalysis(json);
  } catch {
    return null;
  }
}
