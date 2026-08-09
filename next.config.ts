import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * A full CSP is deliberately deferred to Phase 1d: Next.js needs a nonce-based
 * policy to allow its own hydration scripts, and shipping a broken CSP that
 * gets loosened under pressure is worse than adding a correct one once the
 * page inventory is stable.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "pino", "bullmq"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
