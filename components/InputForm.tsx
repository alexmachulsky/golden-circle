'use client';

import { useState } from 'react';
import { EXAMPLES } from '@/lib/prompt';
import { MIN_INPUT_LENGTH, MAX_INPUT_LENGTH } from "@/lib/constants";
import TurnstileWidget from '@/components/TurnstileWidget';

interface InputFormProps {
  onSubmit: (input: string, turnstileToken?: string | null) => void;
  loading: boolean;
  error: string | null;
  turnstileSiteKey?: string | null;
}

export default function InputForm({ onSubmit, loading, error, turnstileSiteKey = null }: InputFormProps) {
  const [input, setInput] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const remaining = MIN_INPUT_LENGTH - input.trim().length;
  const verificationSiteKey = turnstileSiteKey?.trim() ? turnstileSiteKey : null;
  const requiresVerification = Boolean(verificationSiteKey);
  const verificationUnavailable = process.env.NODE_ENV === 'production' && !verificationSiteKey;
  const canSubmit =
    input.trim().length >= MIN_INPUT_LENGTH &&
    !loading &&
    !verificationUnavailable &&
    (!requiresVerification || Boolean(turnstileToken));

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-12 md:py-20">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-3 mb-6">
          <span className="h-px w-10 bg-gold-500/40" />
          <span className="text-gold-500 text-xs font-semibold tracking-[0.2em] uppercase">
            Golden Circle Analyzer
          </span>
          <span className="h-px w-10 bg-gold-500/40" />
        </div>
        <h1
          className="text-4xl md:text-5xl font-bold mb-5 tracking-tight leading-tight"
          style={{ color: 'var(--app-heading)' }}
        >
          Discover Your{' '}
          <span
            className="text-gold-400"
            style={{ filter: 'drop-shadow(0 0 20px rgba(245,158,11,0.4))' }}
          >
            WHY
          </span>
        </h1>
        <p className="text-slate-400 text-lg max-w-lg mx-auto leading-relaxed">
          AI-powered strategic analysis using Simon Sinek&apos;s Golden Circle — engineered to
          produce real depth, not generic platitudes.
        </p>
      </div>

      {/* Framework badges */}
      <div className="flex gap-3 mb-8 justify-center flex-wrap">
        {[
          { label: 'WHY', desc: 'Your belief', opacity: 'bg-gold-500/20 border-gold-500/30 text-gold-300' },
          { label: 'HOW', desc: 'Your method', opacity: 'bg-gold-600/10 border-gold-600/20 text-gold-400' },
          { label: 'WHAT', desc: 'Your evidence', opacity: 'bg-navy-700/60 border-gold-700/20 text-gold-500/70' },
        ].map(({ label, desc, opacity }) => (
          <div
            key={label}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm ${opacity}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            <span className="font-semibold">{label}</span>
            <span className="opacity-60 text-xs">{desc}</span>
          </div>
        ))}
      </div>

      {/* Input card */}
      <div className="rounded-2xl border border-gold-500/10 bg-navy-800/50 overflow-hidden backdrop-blur-sm">
        <div className="p-6">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_INPUT_LENGTH}
            disabled={loading}
            placeholder="Describe your business idea: what problem do you solve, who are your customers, and what makes your approach different? (1–3 paragraphs works best)"
            className="w-full h-44 bg-transparent text-slate-200 placeholder-slate-600 resize-none outline-none text-base leading-relaxed disabled:opacity-50"
          />
        </div>

        {verificationSiteKey && (
          <div className="px-6 pb-5">
            <TurnstileWidget siteKey={verificationSiteKey} onTokenChange={setTurnstileToken} />
          </div>
        )}

        {/* Footer bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gold-500/8 bg-navy-900/40">
          <span
            className={`text-xs font-medium transition-colors ${
              remaining > 0 ? 'text-slate-600' : 'text-gold-500/60'
            }`}
          >
            {remaining > 0 ? (
              <>{remaining} more character{remaining !== 1 ? 's' : ''} to unlock</>
            ) : (
              <>{input.trim().length}/{MAX_INPUT_LENGTH}</>
            )}
          </span>

          <button
            onClick={() => onSubmit(input, turnstileToken)}
            disabled={!canSubmit}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gold-500 text-navy-950 text-sm font-bold hover:bg-gold-400 active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed transition-all duration-150"
          >
            {loading ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-navy-950/30 border-t-navy-950 rounded-full animate-spin" />
                Analyzing
              </>
            ) : (
              <>
                Analyze
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7h12M8 3l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Example buttons */}
      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <span className="text-slate-600 text-xs">Try an example:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => setInput(ex.value)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg border border-navy-700/80 text-slate-500 hover:border-gold-500/30 hover:text-gold-400 disabled:opacity-40 transition-all duration-150"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-5 p-4 rounded-xl bg-red-500/8 border border-red-500/25 text-red-400 text-sm">
          {error}
        </div>
      )}

      {verificationUnavailable && (
        <div className="mt-5 p-4 rounded-xl bg-amber-500/8 border border-amber-500/25 text-amber-300 text-sm">
          Human verification is unavailable right now. Please try again later.
        </div>
      )}

      {/* Framework note */}
      <p className="mt-8 text-center text-slate-700 text-xs">
        Based on Simon Sinek&apos;s Golden Circle framework from{' '}
        <em>Start With Why</em> (2009)
      </p>
    </div>
  );
}
