import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  experimental: { authInterrupts: true },
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/social/**/*": ["./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"],
  },
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
