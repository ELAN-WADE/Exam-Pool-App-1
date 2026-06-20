import type { NextConfig } from "next";

/**
 * Dev  → uses the default `.next/` distDir so the dev server never reads
 *         stale production bundles from `../dist/`.
 * Prod → static export written to `../dist/` for the Bun backend to serve.
 */
const isVercel = process.env.VERCEL === "1";
const isProd = process.env.NODE_ENV === "production" && !isVercel;

const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  ...(isProd && {
    output: "export",
    distDir: "dist",
  }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
    turbo: {
      useSwcCss: false,
    },
  },
  // Proxy API calls to Bun backend in dev mode
  ...(!isProd && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
      ];
    },
  }),
  // Every build gets a unique ID → forces browser/CDN to fetch fresh JS/CSS chunks
  generateBuildId: async () => Date.now().toString(),
};

export default nextConfig;
