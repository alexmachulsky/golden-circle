import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { buildThemeScript } from '@/lib/theme';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: buildThemeScript() }} />
        {children}
      </body>
    </html>
  );
}
