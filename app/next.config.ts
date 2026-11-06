import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Old routes (UX.md section 2): one company page for every phase, Orders replaces My bids.
  async redirects() {
    return [
      { source: "/market", destination: "/", permanent: true },
      { source: "/market/:ticker", destination: "/stock/:ticker", permanent: true },
      { source: "/ipo/:ticker", destination: "/stock/:ticker", permanent: true },
      { source: "/bids", destination: "/orders", permanent: true },
    ];
  },
};

export default nextConfig;
