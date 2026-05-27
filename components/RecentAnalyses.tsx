'use client';

import { useState } from 'react';
import type { HistoryEntry } from '@/lib/analysis-history';

interface RecentAnalysesProps {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function RecentAnalyses({ entries, onRestore, onRemove, onClear }: RecentAnalysesProps) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pb-12 -mt-4">
      <div className="rounded-2xl border border-gold-500/10 bg-navy-800/30 overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-5 py-3 text-left text-sm text-slate-400 hover:text-gold-400 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="font-medium">Recent analyses</span>
            <span className="text-xs text-slate-600">({entries.length})</span>
          </span>
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="border-t border-gold-500/8">
            <ul className="divide-y divide-navy-700/60">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                  <button
                    onClick={() => onRestore(entry)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <p className="truncate text-sm text-slate-300 group-hover:text-gold-300 transition-colors">
                      {entry.input.slice(0, 80) || 'Untitled analysis'}
                    </p>
                    <p className="text-xs text-slate-600">{formatWhen(entry.createdAt)}</p>
                  </button>
                  <button
                    onClick={() => onRemove(entry.id)}
                    aria-label="Remove this analysis from history"
                    className="flex-shrink-0 w-7 h-7 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-5 py-3 border-t border-navy-700/60">
              <span className="text-xs text-slate-600">Stored only in this browser</span>
              <button
                onClick={onClear}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Clear history
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
