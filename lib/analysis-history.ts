import type { AnalysisResult } from "@/types";

// Client-only recent-analysis history, persisted in localStorage. No server,
// no accounts — results live only in the user's browser. Best-effort: every
// access is guarded so a disabled/full/corrupt store never throws into the UI.

const STORAGE_KEY = "gc:history:v1";
const MAX_ENTRIES = 10;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  /** Full original business idea, so a restored analysis can also be refined. */
  input: string;
  result: AnalysisResult;
}

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or serialization error — history is non-critical.
  }
}

export function listAnalyses(): HistoryEntry[] {
  return read();
}

export function saveAnalysis(input: string, result: AnalysisResult): HistoryEntry[] {
  const entry: HistoryEntry = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    input: input.trim(),
    result,
  };
  const next = [entry, ...read()].slice(0, MAX_ENTRIES);
  write(next);
  return next;
}

export function removeAnalysis(id: string): HistoryEntry[] {
  const next = read().filter((e) => e.id !== id);
  write(next);
  return next;
}

export function clearHistory(): void {
  write([]);
}
