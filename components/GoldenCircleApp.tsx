'use client';

import { useState, useCallback } from 'react';
import InputForm from '@/components/InputForm';
import LoadingState from '@/components/LoadingState';
import ResultSection from '@/components/ResultSection';
import ThemeToggle from '@/components/ThemeToggle';
import type { AnalysisResult } from '@/types';
import { parseAnalysis } from '@/lib/validate-analysis';

type AppState = 'input' | 'loading' | 'result';

export default function GoldenCircleApp() {
  const [appState, setAppState] = useState<AppState>('input');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (input: string) => {
    setError(null);
    setAppState('loading');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessIdea: input.trim() }),
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

      // Check for server-side error signal
      if (fullText.startsWith('__ERROR__')) {
        throw new Error(fullText.slice(9));
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
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      setAppState('input');
    }
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setAppState('input');
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
          <InputForm onSubmit={handleSubmit} loading={false} error={error} />
        )}
        {appState === 'loading' && <LoadingState />}
        {appState === 'result' && result && (
          <ResultSection result={result} onReset={handleReset} />
        )}
      </div>
    </main>
  );
}
