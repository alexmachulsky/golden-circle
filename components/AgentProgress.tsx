'use client';

import { motion } from 'framer-motion';
import type { StepName } from '@/lib/agent/events';

export interface StepView {
  step: StepName;
  status: 'start' | 'finish';
}

interface AgentProgressProps {
  steps: StepView[];
  score: number | null;
}

const ORDER: StepName[] = ['analyze', 'critique', 'refine'];

const LABELS: Record<StepName, string> = {
  analyze: 'Drafting the analysis',
  critique: 'Critiquing the draft',
  refine: 'Refining weak points',
};

// Live view of the agent reflection loop while a request is in flight. Each
// step shows idle → active → done; the critique step also surfaces its score.
export default function AgentProgress({ steps, score }: AgentProgressProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {ORDER.map((s) => {
          // The latest event for this step decides its visual state.
          const latest = [...steps].reverse().find((x) => x.step === s);
          const state = !latest ? 'idle' : latest.status === 'finish' ? 'done' : 'active';
          return (
            <div key={s} className="flex items-center gap-3 text-sm">
              <span
                className={
                  state === 'done'
                    ? 'text-gold-400'
                    : state === 'active'
                      ? 'text-gold-300 animate-pulse'
                      : 'text-slate-500'
                }
                aria-hidden="true"
              >
                {state === 'done' ? '✓' : state === 'active' ? '◐' : '○'}
              </span>
              <span className={state === 'idle' ? 'text-slate-500' : 'text-slate-200'}>
                {LABELS[s]}
              </span>
              {s === 'critique' && score !== null && (
                <span className="ml-auto text-gold-300 font-medium tabular-nums">
                  {score.toFixed(1)}/5
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-slate-500 text-sm">The agent drafts, critiques, then refines — usually 30–50 seconds.</p>
    </motion.div>
  );
}
