import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Remove the X-Powered-By: Next.js header
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking protection — CSP frame-ancestors is set in middleware
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Limit referrer information sent to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable browser features not used by the app
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS — instruct browsers to always use HTTPS for this domain
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // CSP is set per-request in middleware.ts (requires a nonce)
        ],
      },
    ];
  },
};

export default nextConfig;
