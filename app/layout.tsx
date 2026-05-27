import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { getTurnstileSiteKey } from '@/lib/turnstile';
import { logger } from '@/lib/logger';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  // metadataBase makes the auto-detected opengraph-image / icons resolve to
  // absolute URLs so shared links unfurl correctly.
  metadataBase: new URL(SITE_URL),
  title: 'Golden Circle Analyzer | AI-Powered Business Strategy',
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_NAME,
    description: "AI-powered strategic analysis using Simon Sinek's Golden Circle framework",
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: "AI-powered strategic analysis using Simon Sinek's Golden Circle framework",
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
    logger.error("layout failed to read Turnstile site key", { err: e instanceof Error ? e.message : String(e) });
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
