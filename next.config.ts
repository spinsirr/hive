import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/sessions/*/files": ["./src/server/workspace/workspace-read.mjs"],
    "/api/sessions/*": [
      "./src/server/agents/codex/bridge/*.mjs",
      "./src/server/agents/codex/bridge/hive-collaboration/SKILL.md",
      "./src/server/agents/codex/codex-auth-refresh.mjs",
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
