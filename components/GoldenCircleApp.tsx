'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import InputForm from '@/components/InputForm';
import AgentProgress, { type StepView } from '@/components/AgentProgress';
import ResultSection from '@/components/ResultSection';
import ThemeToggle from '@/components/ThemeToggle';
import FrameworkIntro from '@/components/FrameworkIntro';
import RecentAnalyses from '@/components/RecentAnalyses';
import type { AnalysisResult } from '@/types';
import type { RefinementKey } from '@/lib/prompt';
import { analysisSchema } from '@/lib/analysis-schema';
import { parseEventLines, type AgentEvent } from '@/lib/agent/events';
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
  const [steps, setSteps] = useState<StepView[]>([]);
  const [score, setScore] = useState<number | null>(null);
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
      setSteps([]);
      setScore(null);
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
        let buffer = '';
        let finalResult: AnalysisResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseEventLines(buffer);
          buffer = rest;
          for (const event of events as AgentEvent[]) {
            if (event.type === 'step') {
              setSteps((prev) => [...prev, { step: event.step, status: event.status }]);
            } else if (event.type === 'critique') {
              setScore(event.critique.overall);
            } else if (event.type === 'final') {
              finalResult = event.result as AnalysisResult;
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          }
        }

        if (!finalResult || !analysisSchema.safeParse(finalResult).success) {
          throw new Error('Received a malformed analysis. Please try again.');
        }

        setResult(finalResult);
        setAppState('result');
        setHistory(saveAnalysis(trimmed, finalResult));
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
        {appState === 'loading' && <AgentProgress steps={steps} score={score} />}
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
