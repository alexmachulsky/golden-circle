'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import GoldenCircle from '@/components/GoldenCircle';
import type { AnalysisResult, ActiveSection } from '@/types';

interface ResultSectionProps {
  result: AnalysisResult;
  onReset: () => void;
}

const cardVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (delay: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, delay, ease: 'easeOut' as const },
  }),
};

const TOOLTIPS = {
  why: 'A strong WHY passes the "product swap test" — it remains true even if the company changed its product line entirely. It is a belief, not a functional description.',
  how: 'HOW items are differentiating actions, values, or processes specific enough that a competitor could not copy-paste them into their own strategy.',
  what:
    'WHAT items are framed as tangible proof of the WHY belief — not a flat product list, but evidence that the belief is real.',
};

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="w-4 h-4 rounded-full border border-slate-600 text-slate-500 hover:border-gold-500/50 hover:text-gold-500 transition-colors text-[10px] font-bold leading-none flex items-center justify-center"
        aria-label="More information"
      >
        i
      </button>
      {show && (
        <span className="absolute left-6 top-0 z-20 w-64 p-3 rounded-lg bg-navy-800 border border-gold-500/15 text-slate-400 text-xs leading-relaxed shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

export default function ResultSection({ result, onReset }: ResultSectionProps) {
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);

  const handleSectionClick = useCallback((section: NonNullable<ActiveSection>) => {
    setActiveSection((prev) => (prev === section ? null : section));
  }, []);

  const handleCopy = useCallback(async () => {
    // Strip control characters (including CR/LF) from each LLM-sourced field
    // before writing to clipboard — prevents "paste-jacking" where a crafted
    // value containing '\n' followed by a shell command executes on paste into
    // a terminal. The join('\n') below is the only intentional line separator.
    const safe = (s: string) =>
      s.replace(/[\x00-\x1F\x7F]/g, ' ').trim();

    const text = [
      `WHY — ${safe(result.why.statement)}`,
      '',
      'HOW',
      ...result.how.map((h, i) => `${i + 1}. ${safe(h.title)}: ${safe(h.description)}`),
      '',
      'WHAT',
      ...result.what.map((w, i) => `${i + 1}. ${safe(w.title)}: ${safe(w.description)}`),
      '',
      `Strategic advantage: ${safe(result.positioning_note)}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (non-HTTPS context or permission denied)
    }
  }, [result]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-10">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
        <button
          onClick={onReset}
          className="flex items-center gap-2 text-slate-500 hover:text-gold-400 text-sm transition-colors group"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="group-hover:-translate-x-0.5 transition-transform"
          >
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Analyze another
        </button>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-navy-700 text-slate-400 hover:border-gold-500/30 hover:text-gold-400 text-xs transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M1 8V2a1 1 0 011-1h6"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            Copy
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-navy-700 text-slate-400 hover:border-gold-500/30 hover:text-gold-400 text-xs transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 4V1h6v3M1 4h10v5H1zM3 9v2h6V9"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Save PDF
          </button>
        </div>
      </div>

      {/* Positioning note banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 p-4 rounded-xl bg-gold-500/5 border border-gold-500/15 text-gold-300/80 text-sm text-center leading-relaxed"
      >
        <span className="text-gold-500/50 text-xs font-semibold uppercase tracking-widest mr-2">
          Strategic Advantage
        </span>
        {result.positioning_note}
      </motion.div>

      {/* Main grid: circle + cards */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-10 items-start">
        {/* Left: Interactive circle */}
        <div className="lg:sticky lg:top-8 flex flex-col items-center gap-6">
          <GoldenCircle
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
            animate
          />
          {/* Legend */}
          <div className="w-full max-w-[260px] space-y-2">
            {(
              [
                { section: 'why', label: 'WHY', desc: 'Core belief' },
                { section: 'how', label: 'HOW', desc: 'Differentiating actions' },
                { section: 'what', label: 'WHAT', desc: 'Products as proof' },
              ] as { section: NonNullable<ActiveSection>; label: string; desc: string }[]
            ).map(({ section, label, desc }) => (
              <button
                key={section}
                onClick={() => handleSectionClick(section)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-xs transition-all ${
                  activeSection === section
                    ? 'bg-gold-500/10 border border-gold-500/25 text-gold-300'
                    : 'border border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background:
                      section === 'why'
                        ? 'rgba(245,158,11,0.9)'
                        : section === 'how'
                          ? 'rgba(245,158,11,0.55)'
                          : 'rgba(245,158,11,0.25)',
                  }}
                />
                <span className="font-semibold">{label}</span>
                <span className="opacity-60">{desc}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-700 text-center">Click a ring to explore</p>
        </div>

        {/* Right: cards */}
        <div className="space-y-5">
          {/* WHY Card */}
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            custom={0.2}
            id="why-card"
            className={`rounded-2xl border p-6 md:p-8 transition-all duration-300 ${
              activeSection === 'why' || activeSection === null
                ? 'border-gold-500/30 bg-navy-800/70'
                : 'border-gold-500/8 bg-navy-800/30 opacity-60'
            }`}
            style={{ borderLeftWidth: '3px', borderLeftColor: 'rgba(245,158,11,0.7)' }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="px-3 py-1 rounded-full bg-gold-500/15 border border-gold-500/25 text-gold-300 text-xs font-bold tracking-widest uppercase">
                WHY
              </span>
              <span className="text-slate-500 text-xs">Core belief</span>
              <Tooltip text={TOOLTIPS.why} />
            </div>
            <blockquote className="text-xl md:text-2xl font-medium text-gold-200 leading-relaxed italic mb-5">
              &ldquo;{result.why.statement}&rdquo;
            </blockquote>
            <div className="pt-4 border-t border-gold-500/10">
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1.5">
                Why this passes the product swap test
              </p>
              <p className="text-slate-400 text-sm leading-relaxed">{result.why.depth_note}</p>
            </div>
          </motion.div>

          {/* HOW Card */}
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            custom={0.5}
            id="how-card"
            className={`rounded-2xl border p-6 md:p-8 transition-all duration-300 ${
              activeSection === 'how' || activeSection === null
                ? 'border-gold-600/20 bg-navy-800/70'
                : 'border-gold-500/8 bg-navy-800/30 opacity-60'
            }`}
            style={{ borderLeftWidth: '3px', borderLeftColor: 'rgba(217,119,6,0.55)' }}
          >
            <div className="flex items-center gap-3 mb-6">
              <span className="px-3 py-1 rounded-full bg-gold-600/10 border border-gold-600/20 text-gold-400 text-xs font-bold tracking-widest uppercase">
                HOW
              </span>
              <span className="text-slate-500 text-xs">Differentiating actions</span>
              <Tooltip text={TOOLTIPS.how} />
            </div>
            <div className="space-y-5">
              {result.how.map((item, i) => (
                <div key={i} className="group">
                  <div className="flex gap-4">
                    <span className="mt-0.5 text-xs font-mono text-gold-600/60 font-bold w-5 flex-shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                      <h4 className="text-slate-100 font-semibold text-sm mb-1.5">{item.title}</h4>
                      <p className="text-slate-400 text-sm leading-relaxed mb-2">
                        {item.description}
                      </p>
                      <p className="text-gold-600/70 text-xs leading-relaxed flex gap-1.5">
                        <span className="flex-shrink-0 mt-0.5">↳</span>
                        <span>{item.uniqueness}</span>
                      </p>
                    </div>
                  </div>
                  {i < result.how.length - 1 && (
                    <div className="mt-5 ml-9 h-px bg-gradient-to-r from-gold-500/10 to-transparent" />
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* WHAT Card */}
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            custom={0.8}
            id="what-card"
            className={`rounded-2xl border p-6 md:p-8 transition-all duration-300 ${
              activeSection === 'what' || activeSection === null
                ? 'border-gold-700/15 bg-navy-800/70'
                : 'border-gold-500/8 bg-navy-800/30 opacity-60'
            }`}
            style={{ borderLeftWidth: '3px', borderLeftColor: 'rgba(180,83,9,0.4)' }}
          >
            <div className="flex items-center gap-3 mb-6">
              <span className="px-3 py-1 rounded-full bg-navy-700/80 border border-gold-700/20 text-gold-500/70 text-xs font-bold tracking-widest uppercase">
                WHAT
              </span>
              <span className="text-slate-500 text-xs">Products as proof</span>
              <Tooltip text={TOOLTIPS.what} />
            </div>
            <div className="space-y-6">
              {result.what.map((item, i) => (
                <div key={i}>
                  <h4 className="text-slate-100 font-semibold text-sm mb-1.5">{item.title}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed mb-2">{item.description}</p>
                  <p className="text-gold-700/80 text-xs leading-relaxed flex gap-1.5">
                    <span className="flex-shrink-0 mt-0.5">↳</span>
                    <span>{item.why_connection}</span>
                  </p>
                  {i < result.what.length - 1 && (
                    <div className="mt-5 h-px bg-gradient-to-r from-gold-500/8 to-transparent" />
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="mt-10 pt-8 border-t border-navy-800 flex items-center justify-center gap-4 flex-wrap">
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-xl bg-gold-500 text-navy-950 text-sm font-bold hover:bg-gold-400 active:scale-95 transition-all duration-150"
        >
          Analyze Another Idea
        </button>
        <button
          onClick={handleCopy}
          className="px-6 py-2.5 rounded-xl border border-navy-700 text-slate-400 hover:border-gold-500/30 hover:text-gold-400 text-sm transition-all"
        >
          Copy to Clipboard
        </button>
        <button
          onClick={handlePrint}
          className="px-6 py-2.5 rounded-xl border border-navy-700 text-slate-400 hover:border-gold-500/30 hover:text-gold-400 text-sm transition-all"
        >
          Save as PDF
        </button>
      </div>
    </div>
  );
}
