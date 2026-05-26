'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import InputForm from '@/components/InputForm';
import LoadingState from '@/components/LoadingState';
import ResultSection from '@/components/ResultSection';
import ThemeToggle from '@/components/ThemeToggle';
import FrameworkIntro from '@/components/FrameworkIntro';
import RecentAnalyses from '@/components/RecentAnalyses';
import type { AnalysisResult } from '@/types';
import type { RefinementKey } from '@/lib/prompt';
import { parseAnalysis } from '@/lib/validate-analysis';
import { decodeAnalysisFromHash } from '@/lib/share-link';
import {
  listAnalyses,
  saveAnalysis,
  removeAnalysis,
  clearHistory,
  type HistoryEntry,
} from '@/lib/analysis-history';

type AppState = 'input' | 'loading' | 'result';

interface GoldenCircleAppProps {
  turnstileSiteKey: string | null;
}

// Abort the stream if the server never finishes; the server's own upstream
// timeout is 60s, so this is a slightly longer client backstop.
const CLIENT_TIMEOUT_MS = 75_000;

// Map an HTTP failure to user-facing copy. Falls back to the server-provided
// message (already sanitized server-side) for anything unrecognized.
function failureMessage(status: number, serverError?: string): string {
  if (status === 429) return "You're sending requests too quickly. Please wait a minute and try again.";
  if (status === 503) return 'The analyzer is temporarily unavailable. Please try again shortly.';
  return serverError || 'Analysis failed. Please try again.';
}

export default function GoldenCircleApp({ turnstileSiteKey }: GoldenCircleAppProps) {
  const [appState, setAppState] = useState<AppState>('input');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // The base idea behind the current result, so "refine" can re-run it.
  const lastInputRef = useRef<string>('');

  // Refine re-runs need a fresh request but have no new Turnstile token (the
  // widget only lives on the input form, tokens are single-use). So refine is
  // only offered when human-verification isn't required.
  const refineEnabled = !turnstileSiteKey;

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Load history (client-only) on mount
  useEffect(() => {
    setHistory(listAnalyses());
  }, []);

  // Restore a shared analysis from the URL hash on first load (decode is async
  // because the payload may be gzip-compressed).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    decodeAnalysisFromHash(window.location.hash).then((restored) => {
      if (!cancelled && restored) {
        setResult(restored);
        setAppState('result');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Guard: if result state is reached with no data, reset to input
  useEffect(() => {
    if (appState === 'result' && !result) {
      setError('Something went wrong. Please try again.');
      setAppState('input');
    }
  }, [appState, result]);

  const handleSubmit = useCallback(
    async (input: string, turnstileToken: string | null = null, refinement: RefinementKey | null = null) => {
      // Cancel any previous in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const trimmed = input.trim();
      lastInputRef.current = trimmed;

      // Client-side backstop: if the stream never completes, abort and tell the
      // user it timed out (distinguished from user/unmount aborts via the flag).
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CLIENT_TIMEOUT_MS);

      setError(null);
      setAppState('loading');

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessIdea: trimmed, turnstileToken, refinement }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(failureMessage(response.status, errorData.error));
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          if (fullText.length > 64_000) {
            throw new Error("Response too large. Please try again.");
          }
        }
        // Flush any remaining buffered bytes from the decoder
        fullText += decoder.decode();

        // Check for server-side error signal. Cap and strip the suffix so a
        // prompt-injected response can never surface arbitrary text as a UI error.
        if (fullText.startsWith('__ERROR__')) {
          const raw = fullText.slice(9, 300).replace(/[^\x20-\x7E\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]/g, '');
          throw new Error(raw || 'Analysis failed. Please try again.');
        }

        let parsed;
        try {
          parsed = parseAnalysis(fullText);
        } catch {
          throw new Error('Could not parse the AI response. Please try again.');
        }

        setResult(parsed);
        setAppState('result');
        setHistory(saveAnalysis(trimmed, parsed));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Timeout aborts surface a message; user/unmount aborts stay silent.
          if (timedOut) {
            setError('The request timed out. Please try again.');
            setAppState('input');
          }
          return;
        }
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setError(message);
        setAppState('input');
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [],
  );

  const handleRefine = useCallback(
    (refinement: RefinementKey) => {
      if (!lastInputRef.current) return;
      handleSubmit(lastInputRef.current, null, refinement);
    },
    [handleSubmit],
  );

  const handleRestore = useCallback((entry: HistoryEntry) => {
    lastInputRef.current = entry.input;
    setResult(entry.result);
    setError(null);
    setAppState('result');
  }, []);

  const handleRemove = useCallback((id: string) => {
    setHistory(removeAnalysis(id));
  }, []);

  const handleClear = useCallback(() => {
    clearHistory();
    setHistory([]);
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setAppState('input');
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col">
      <div className="relative z-20 w-full px-4 pt-4 no-print">
        <div className="mx-auto flex max-w-6xl justify-end">
          <ThemeToggle />
        </div>
      </div>

      {/* Subtle radial glow background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'var(--app-overlay-glow)' }}
      />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-start">
        {appState === 'input' && (
          <>
            <FrameworkIntro />
            <InputForm
              onSubmit={handleSubmit}
              loading={false}
              error={error}
              turnstileSiteKey={turnstileSiteKey}
            />
            <RecentAnalyses
              entries={history}
              onRestore={handleRestore}
              onRemove={handleRemove}
              onClear={handleClear}
            />
          </>
        )}
        {appState === 'loading' && <LoadingState />}
        {appState === 'result' && result && (
          <ResultSection
            result={result}
            onReset={handleReset}
            onRefine={refineEnabled ? handleRefine : undefined}
          />
        )}
      </div>
    </main>
  );
}
