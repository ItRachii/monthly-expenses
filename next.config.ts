import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Sent on every response. CSP and HSTS are production-only: dev needs
// webpack's eval'd HMR scripts, and HSTS is meaningless over http://localhost.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Never leak the (authenticated) URL a user came from to external sites.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Next.js bootstrap scripts (inline) + WASM compile for the
            // in-browser receipt OCR (Tesseract.js core). jsDelivr serves the
            // OCR worker/core/model on demand; no other third-party scripts.
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
            // Tailwind/recharts set inline styles.
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://lh3.googleusercontent.com",
            "font-src 'self' data:",
            // 'self' for the app; jsDelivr for the OCR core/model downloads.
            "connect-src 'self' https://cdn.jsdelivr.net",
            // Tesseract runs recognition in a blob-URL web worker.
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "manifest-src 'self'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  eslint: {
    // Lint is run separately; do not block production builds on lint.
    ignoreDuringBuilds: true,
  },
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  images: {
    // Google profile pictures.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
