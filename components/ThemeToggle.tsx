'use client';

import type { CSSProperties } from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import {
  applyThemeToDocument,
  getServerThemeSnapshot,
  getThemeSnapshot,
  subscribeToThemeChange,
} from '@/lib/theme';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5V3M8 13V14.5M3.4 3.4L4.45 4.45M11.55 11.55L12.6 12.6M1.5 8H3M13 8H14.5M3.4 12.6L4.45 11.55M11.55 4.45L12.6 3.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.99 1.74a5.88 5.88 0 103.27 10.91A6.55 6.55 0 1110.99 1.74z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const shellStyle: CSSProperties = {
  background: 'var(--theme-toggle-bg)',
  borderColor: 'var(--theme-toggle-border)',
  boxShadow: 'var(--theme-toggle-shadow)',
};

const iconStyle: CSSProperties = {
  background: 'var(--theme-toggle-active-bg)',
  borderColor: 'var(--theme-toggle-active-border)',
  color: 'var(--theme-toggle-text-active)',
};

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToThemeChange,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const handleToggle = useCallback(() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    applyThemeToDocument(nextTheme);
  }, [theme]);

  if (theme !== 'dark' && theme !== 'light') {
    return null;
  }

  const Icon = theme === 'dark' ? MoonIcon : SunIcon;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className="flex items-center gap-3 rounded-full border px-3 py-2 backdrop-blur-xl transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
      style={shellStyle}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full border" style={iconStyle}>
        <Icon />
      </span>
      <span className="hidden text-left sm:block">
        <span
          className="block text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--theme-toggle-text)' }}
        >
          Theme
        </span>
        <span className="block text-sm font-medium" style={{ color: 'var(--theme-toggle-text-active)' }}>
          {theme === 'dark' ? 'Dark mode' : 'Light mode'}
        </span>
      </span>
    </button>
  );
}
