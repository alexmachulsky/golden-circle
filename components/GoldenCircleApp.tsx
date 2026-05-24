'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import InputForm from '@/components/InputForm';
import LoadingState from '@/components/LoadingState';
import ResultSection from '@/components/ResultSection';
import ThemeToggle from '@/components/ThemeToggle';
import type { AnalysisResult } from '@/types';
import { parseAnalysis } from '@/lib/validate-analysis';
import { decodeAnalysisFromHash } from '@/lib/share-link';

type AppState = 'input' | 'loading' | 'result';

interface GoldenCircleAppProps {
  turnstileSiteKey: string | null;
}

export default function GoldenCircleApp({ turnstileSiteKey }: GoldenCircleAppProps) {
  const [appState, setAppState] = useState<AppState>('input');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Restore a shared analysis from the URL hash on first load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const restored = decodeAnalysisFromHash(window.location.hash);
    if (restored) {
      setResult(restored);
      setAppState('result');
    }
  }, []);

  // Guard: if result state is reached with no data, reset to input
  useEffect(() => {
    if (appState === 'result' && !result) {
      setError('Something went wrong. Please try again.');
      setAppState('input');
    }
  }, [appState, result]);

  const handleSubmit = useCallback(async (input: string, turnstileToken: string | null = null) => {
    // Cancel any previous in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setError(null);
    setAppState('loading');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessIdea: input.trim(), turnstileToken }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(errorData.error || 'Analysis failed');
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
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      setAppState('input');
    }
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
          <InputForm
            onSubmit={handleSubmit}
            loading={false}
            error={error}
            turnstileSiteKey={turnstileSiteKey}
          />
        )}
        {appState === 'loading' && <LoadingState />}
        {appState === 'result' && result && (
          <ResultSection result={result} onReset={handleReset} />
        )}
      </div>
    </main>
  );
}
