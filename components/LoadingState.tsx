'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const MESSAGES = [
  'Analyzing your business purpose…',
  'Crafting your Golden Circle…',
  'Applying strategic constraints…',
  'Testing WHY depth…',
  'Finding what makes you different…',
  'Verifying output quality…',
];

export default function LoadingState() {
  const reduceMotion = useReducedMotion();
  const cx = 120, cy = 120;
  const WHY_R = 36;
  const HOW_R = 68;
  const WHAT_R = 100;

  // Cycle the status message and track elapsed time so a long wait reads as
  // intentional progress rather than a stall.
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const msgTimer = setInterval(
      () => setMessageIndex((i) => (i + 1) % MESSAGES.length),
      3000,
    );
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(msgTimer);
      clearInterval(tick);
    };
  }, []);

  function circlePath(r: number, cw = true): string {
    const sw = cw ? 1 : 0;
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 ${sw} ${cx - r} ${cy} A ${r} ${r} 0 1 ${sw} ${cx + r} ${cy} Z`;
  }

  function annulusPath(r1: number, r2: number): string {
    return `${circlePath(r2, true)} ${circlePath(r1, false)}`;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-10">
      <div className="relative">
        <svg width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="Generating your Golden Circle analysis">
          {/* WHAT ring */}
          <motion.path
            d={annulusPath(HOW_R, WHAT_R)}
            fillRule="evenodd"
            fill="rgba(245,158,11,0.12)"
            stroke="rgba(245,158,11,0.3)"
            strokeWidth="0.5"
            style={{ transformOrigin: `${cx}px ${cy}px` }}
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={reduceMotion ? undefined : { duration: 20, repeat: Infinity, ease: 'linear' }}
          />
          {/* HOW ring */}
          <motion.path
            d={annulusPath(WHY_R, HOW_R)}
            fillRule="evenodd"
            fill="rgba(245,158,11,0.25)"
            stroke="rgba(245,158,11,0.4)"
            strokeWidth="0.5"
            style={{ transformOrigin: `${cx}px ${cy}px` }}
            animate={reduceMotion ? undefined : { rotate: -360 }}
            transition={reduceMotion ? undefined : { duration: 14, repeat: Infinity, ease: 'linear' }}
          />
          {/* WHY circle */}
          <motion.circle
            cx={cx}
            cy={cy}
            r={WHY_R}
            fill="rgba(245,158,11,0.7)"
            animate={reduceMotion ? undefined : { scale: [1, 1.06, 1] }}
            transition={reduceMotion ? undefined : { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              filter: 'drop-shadow(0 0 14px rgba(245,158,11,0.6))',
            }}
          />
          {/* Center WHY text */}
          <text
            x={cx}
            y={cy + 5}
            textAnchor="middle"
            fontSize="13"
            fontWeight="700"
            fill="#04091a"
            style={{ userSelect: 'none' }}
            letterSpacing="2"
          >
            WHY
          </text>
        </svg>
      </div>

      {/* Cycling status message — a single live region so screen readers
          announce each step (works regardless of motion preference). */}
      <div className="text-center" role="status" aria-live="polite">
        <p className="text-gold-400 text-base font-medium">{MESSAGES[messageIndex]}</p>
      </div>

      <p className="text-slate-500 text-sm">
        {elapsed}s elapsed · usually 25–35 seconds
      </p>
    </div>
  );
}
