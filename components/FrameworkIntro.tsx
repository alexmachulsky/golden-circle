'use client';

import { useState, useSyncExternalStore } from 'react';

const DISMISS_KEY = 'gc:introDismissed:v1';

// Read the dismiss flag through useSyncExternalStore so the client-only
// localStorage access is SSR-safe and doesn't trip set-state-in-effect.
function subscribe() {
  return () => {};
}
function getDismissedSnapshot(): boolean {
  try {
    return Boolean(window.localStorage.getItem(DISMISS_KEY));
  } catch {
    return true; // treat unreadable storage as "already dismissed" (don't nag)
  }
}
function getServerSnapshot(): boolean {
  return true; // hidden during SSR; revealed after hydration if not dismissed
}

const STEPS = [
  {
    label: 'WHY',
    title: 'Your core belief',
    desc: 'The purpose or conviction behind the work — true even if the product changed entirely.',
    tone: 'bg-gold-500/15 border-gold-500/30 text-gold-300',
  },
  {
    label: 'HOW',
    title: 'Your differentiating actions',
    desc: 'The specific methods and values a competitor couldn’t copy-paste into their own strategy.',
    tone: 'bg-gold-600/10 border-gold-600/20 text-gold-400',
  },
  {
    label: 'WHAT',
    title: 'Your proof',
    desc: 'The products and outputs, framed as tangible evidence that the belief is real.',
    tone: 'bg-navy-700/60 border-gold-700/20 text-gold-500/70',
  },
];

export default function FrameworkIntro() {
  const alreadyDismissed = useSyncExternalStore(subscribe, getDismissedSnapshot, getServerSnapshot);
  const [dismissedNow, setDismissedNow] = useState(false);

  if (alreadyDismissed || dismissedNow) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Non-critical — still hide for this session.
    }
    setDismissedNow(true);
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-10">
      <div className="relative rounded-2xl border border-gold-500/15 bg-navy-800/50 p-6 backdrop-blur-sm">
        <button
          onClick={dismiss}
          aria-label="Dismiss introduction"
          className="absolute top-4 right-4 w-7 h-7 rounded-md text-slate-500 hover:text-gold-400 hover:bg-gold-500/10 transition-colors flex items-center justify-center"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <h2 className="text-sm font-semibold tracking-widest uppercase text-gold-500 mb-1">
          New here? The Golden Circle in 30 seconds
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-5">
          Great organizations communicate from the inside out — WHY before HOW before WHAT.
          Describe your idea below and the analyzer builds all three layers.
        </p>

        <ol className="space-y-3">
          {STEPS.map(({ label, title, desc, tone }) => (
            <li key={label} className="flex gap-3">
              <span
                className={`flex-shrink-0 px-2.5 py-1 h-fit rounded-full border text-[10px] font-bold tracking-widest uppercase ${tone}`}
              >
                {label}
              </span>
              <span className="text-sm">
                <span className="text-slate-200 font-medium">{title}.</span>{' '}
                <span className="text-slate-400">{desc}</span>
              </span>
            </li>
          ))}
        </ol>

        <button
          onClick={dismiss}
          className="mt-6 px-5 py-2 rounded-xl bg-gold-500 text-navy-950 text-sm font-bold hover:bg-gold-400 active:scale-95 transition-all duration-150"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
