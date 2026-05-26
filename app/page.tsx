import { headers } from 'next/headers';
import GoldenCircleApp from '@/components/GoldenCircleApp';
import { getTurnstileSiteKey } from '@/lib/turnstile';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/site';

export default async function Home() {
  // The JSON-LD <script> is inline, so it must carry the per-request CSP nonce
  // (set by proxy.ts and forwarded as the x-nonce request header) or the strict
  // production CSP would block it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  // Fully static, server-controlled structured data (no user input). Escape "<"
  // to "<" so the serialized JSON can never break out of the <script> tag.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  const jsonLdHtml = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
      />
      <GoldenCircleApp turnstileSiteKey={getTurnstileSiteKey()} />
    </>
  );
}
