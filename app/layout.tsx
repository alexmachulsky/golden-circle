import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { buildThemeScript } from '@/lib/theme';
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
  // Read the nonce injected by middleware.ts so the inline theme bootstrap
  // script is allowed under the Content-Security-Policy.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const turnstileSiteKey = getTurnstileSiteKey();

  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: buildThemeScript() }} />
        {turnstileSiteKey && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            nonce={nonce}
          />
        )}
        {children}
      </body>
    </html>
  );
}
