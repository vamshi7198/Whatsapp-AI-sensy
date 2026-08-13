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

  experimental: {
    serverActions: {
      /**
       * Contact imports are uploaded through a server action, and the default
       * ceiling here is 1 MB — well under the 10 MB the importer itself
       * accepts and validates. A larger CSV therefore failed before any of
       * our own checks ran, with a framework error rather than an explanation.
       *
       * Matched to IMPORT_LIMITS.MAX_FILE_BYTES, so the limit an operator is
       * told about is the limit they actually hit.
       */
      bodySizeLimit: "10mb",
    },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
