import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-codex",
    "@ai-sdk/sandbox-vercel",
    "@vercel/sandbox",
  ],
};

export default nextConfig;
