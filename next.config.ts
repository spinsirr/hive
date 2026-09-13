import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/sessions/*": [
      "./src/lib/codex-bridge/*.mjs",
      "./src/lib/codex-bridge/hive-collaboration/SKILL.md",
      "./src/lib/codex-auth-refresh.mjs",
      "./node_modules/.cache/hive/codex-bridge.mjs",
    ],
  },
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-codex",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/sandbox-vercel",
    "@vercel/sandbox",
  ],
};

export default nextConfig;
