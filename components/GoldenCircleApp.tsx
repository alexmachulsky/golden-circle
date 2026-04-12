'use client';

import { useState, useCallback } from 'react';
import InputForm from '@/components/InputForm';
import LoadingState from '@/components/LoadingState';
import ResultSection from '@/components/ResultSection';
import type { AnalysisResult } from '@/types';

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
      }

      // Check for server-side error signal
      if (fullText.startsWith('__ERROR__')) {
        throw new Error(fullText.slice(9));
      }

      // Strip markdown code fences if the model wrapped the JSON
      let cleaned = fullText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();

      // Extract just the outermost JSON object
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) {
        throw new Error('Invalid response format. Please try again.');
      }
      cleaned = cleaned.slice(start, end + 1);

      // Fix trailing commas before ] or } (common LLM mistake)
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

      let parsed: AnalysisResult;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('Could not parse the AI response. Please try again.');
      }

      // Basic validation
      if (!parsed.why?.statement || !Array.isArray(parsed.how) || !Array.isArray(parsed.what)) {
        throw new Error('Incomplete response received. Please try again.');
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
    <main className="min-h-screen flex flex-col">
      {/* Subtle radial glow background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(245,158,11,0.05) 0%, transparent 70%)',
        }}
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
