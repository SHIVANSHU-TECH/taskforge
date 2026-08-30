/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. Next.js injects small inline bootstrap scripts and we
// ship an inline no-flash theme script, so script/style need 'unsafe-inline'.
// Dev additionally needs 'unsafe-eval' (React Refresh) and ws: (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS only makes sense over HTTPS; harmless in dev but scoped to prod to avoid
  // pinning localhost to https during local testing.
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig = {
  reactStrictMode: true,
  // We run lint separately (see `npm run typecheck`); don't block builds on it during bootstrap.
  eslint: { ignoreDuringBuilds: true },
  // bcryptjs is fine in Node runtime; keep server-only packages external.
  serverExternalPackages: ["bcryptjs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
