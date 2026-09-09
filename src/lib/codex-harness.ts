import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCodex, type CodexHarnessSettings } from "@ai-sdk/harness-codex";

/** Keep the existing harness lifecycle/auth; replace only its sandbox turn driver. */
export function createHiveCodex(
  settings: CodexHarnessSettings,
  onGatewayDiagnostic?: (attributes: Record<string, unknown>) => void,
) {
  const harness = createCodex(settings);
  const getBootstrap = harness.getBootstrap;
  return {
    ...harness,
    async doStart(options: Parameters<typeof harness.doStart>[0]) {
      return harness.doStart({
        ...options,
        // The framework's global debug sink also prints raw console lines.
        // Forward only our structured request metadata, never sandbox logs.
        observability: {
          debug: { enabled: true, level: "info", subsystems: ["hive.gateway"] },
          report(event) {
            if (event.kind === "event" && event.subsystem === "hive.gateway") {
              onGatewayDiagnostic?.(event.attrs ?? {});
            }
          },
        },
      });
    },
    async getBootstrap(...args: Parameters<NonNullable<typeof getBootstrap>>) {
      const recipe = await getBootstrap?.(...args);
      if (!recipe) throw new Error("The Codex harness bootstrap is unavailable.");
      // Use the public, self-contained bridge runtime. It depends only on Node
      // and ws, already installed by the unchanged, pinned sandbox recipe.
      const assets = [
        ["runtime.mjs", path.join(process.cwd(), "node_modules/.cache/hive/codex-bridge.mjs")],
        ["bridge.mjs", path.join(process.cwd(), "src/lib/codex-bridge/bridge.mjs")],
        ["app-server.mjs", path.join(process.cwd(), "src/lib/codex-bridge/app-server.mjs")],
        ["gateway-transport.mjs", path.join(process.cwd(), "src/lib/codex-bridge/gateway-transport.mjs")],
        ["hive-collaboration/SKILL.md", path.join(process.cwd(), "src/lib/codex-bridge/hive-collaboration/SKILL.md")],
      ];
      const files = await Promise.all(assets.map(async ([name, source]) => ({
        path: `${recipe.bootstrapDir}/${name}`,
        content: await readFile(source, "utf8"),
      })));
      return {
        ...recipe,
        files: [...recipe.files.filter((file) => !files.some((asset) => asset.path === file.path)), ...files],
      };
    },
  };
}
