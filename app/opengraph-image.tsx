import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/site';

export const runtime = 'nodejs';
export const alt = "Golden Circle Analyzer — discover your business's WHY";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Concentric ring (WHY/HOW/WHAT) motif in the app's navy/gold palette.
function Ring({ size: s, opacity }: { size: number; opacity: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: s,
        height: s,
        borderRadius: '9999px',
        border: '2px solid rgba(245,158,11,0.55)',
        background: `rgba(245,158,11,${opacity})`,
      }}
    />
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          background: '#04091a',
          color: '#fef3c7',
          fontFamily: 'sans-serif',
          padding: '0 90px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 360,
            height: 360,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Ring size={360} opacity={0.06} />
          <Ring size={244} opacity={0.12} />
          <Ring size={128} opacity={0.85} />
          <div style={{ position: 'absolute', fontSize: 30, fontWeight: 800, color: '#04091a', letterSpacing: 4 }}>
            WHY
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 70 }}>
          <div style={{ fontSize: 22, letterSpacing: 6, color: '#f59e0b', textTransform: 'uppercase' }}>
            {SITE_NAME}
          </div>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.1, marginTop: 16 }}>
            <span style={{ color: '#ffffff' }}>Discover your&nbsp;</span>
            <span style={{ color: '#fbbf24' }}>WHY</span>
          </div>
          <div style={{ fontSize: 28, color: '#94a3b8', marginTop: 24, maxWidth: 560, lineHeight: 1.4 }}>
            AI-powered strategic analysis using Simon Sinek&apos;s Golden Circle.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
