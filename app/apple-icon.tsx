import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#04091a',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 150,
            height: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ position: 'absolute', width: 150, height: 150, borderRadius: 9999, border: '6px solid rgba(245,158,11,0.45)' }} />
          <div style={{ position: 'absolute', width: 100, height: 100, borderRadius: 9999, border: '6px solid rgba(245,158,11,0.7)' }} />
          <div style={{ width: 52, height: 52, borderRadius: 9999, background: '#fbbf24' }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
