import type { NextConfig } from "next";

import {
  FRAMEABLE_SOURCES,
  UNFRAMEABLE_SOURCE,
  frameAncestors,
} from "./src/lib/payments/checkout-embed";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    /* Files reach the server through server actions — a lesson board, a
       worksheet, a student's IA — and the default body limit for one is 1 MB.
       Both upload paths advertise 25 MB and validate against it, so without
       this every genuine upload is refused by the framework before any of our
       own checks run, with an error written for a developer.
       Kept slightly above 25 MB so the limit a student meets is ours, and says
       something useful. */
    serverActions: { bodySizeLimit: "26mb" },
  },
  // The portal is authenticated, so nothing here should ever be cached by a
  // shared proxy. Route-level `dynamic` handles rendering; this covers headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      /* Nothing may frame the portal — except checkout, which the marketing
         site opens in a sheet so a buyer never leaves it. The two rules are
         complements on purpose: a path gets X-Frame-Options or a
         frame-ancestors policy, never both, because browsers disagree about
         which wins when they conflict. See src/lib/payments/checkout-embed.ts. */
      {
        source: UNFRAMEABLE_SOURCE,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      ...FRAMEABLE_SOURCES.map((source) => ({
        source,
        headers: [
          {
            key: "Content-Security-Policy",
            value: frameAncestors(process.env.NODE_ENV !== "production"),
          },
        ],
      })),
    ];
  },
};

export default nextConfig;
