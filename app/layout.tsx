import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { getTurnstileSiteKey } from '@/lib/turnstile';
import './globals.css';

export const metadata: Metadata = {
  title: 'Golden Circle Analyzer | AI-Powered Business Strategy',
  description:
    "Discover your business's WHY, HOW, and WHAT using Simon Sinek's Golden Circle framework — powered by AI engineered to produce real depth, not generic platitudes.",
  openGraph: {
    title: 'Golden Circle Analyzer',
    description: "AI-powered strategic analysis using Simon Sinek's Golden Circle framework",
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfaf4' },
    { media: '(prefers-color-scheme: dark)', color: '#04091a' },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let turnstileSiteKey: string | null = null;
  try {
    turnstileSiteKey = getTurnstileSiteKey();
  } catch (e) {
    console.error("[layout] Failed to read Turnstile site key:", e);
  }
  // Force dynamic rendering so Next can read the per-request CSP nonce from
  // proxy.ts and attach it to inline framework scripts/styles during SSR.
  await headers();

  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {/* Synchronous theme bootstrap must run before paint to avoid FOUC.
            Using next/script with strategy="beforeInteractive" caused a CSP
            nonce hydration mismatch under Turbopack; a plain <script> with
            the nonce attached by proxy.ts is intentional here. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
        {turnstileSiteKey && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
