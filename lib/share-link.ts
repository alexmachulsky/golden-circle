import type { AnalysisResult } from "@/types";
import { parseAnalysis } from "@/lib/validate-analysis";

const HASH_PREFIX = "#data=";
const MAX_ENCODED_LENGTH = 8 * 1024;

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeAnalysisForUrl(result: AnalysisResult): string {
  return toBase64Url(JSON.stringify(result));
}

export function buildShareUrl(result: AnalysisResult, origin: string, pathname: string): string {
  return `${origin}${pathname}${HASH_PREFIX}${encodeAnalysisForUrl(result)}`;
}

export function decodeAnalysisFromHash(hash: string): AnalysisResult | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded || encoded.length > MAX_ENCODED_LENGTH) return null;
  let json: string;
  try {
    json = fromBase64Url(encoded);
  } catch {
    return null;
  }
  try {
    return parseAnalysis(json);
  } catch {
    return null;
  }
}
