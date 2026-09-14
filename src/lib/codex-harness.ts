import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCodex, type CodexHarnessSettings } from "@ai-sdk/harness-codex";
import {
  subagentUpdateSchema,
  type HiveSubagentUpdate,
} from "./hive-subagents.ts";
import {
  codexAccessPlaceholder,
  codexOAuthTransformations,
  type CodexAccess,
} from "./codex-subscription-broker.ts";
import { withHiveCodexTools } from "./hive-codex-tools.ts";

/** Keep the existing harness lifecycle/auth; replace only its sandbox turn driver. */
export function createHiveCodex(
  settings: CodexHarnessSettings,
  onGatewayDiagnostic?: (attributes: Record<string, unknown>) => void,
  onSubagents?: (update: HiveSubagentUpdate) => void,
  subscription?: CodexAccess
) {
  const placeholder = subscription
    ? codexAccessPlaceholder(subscription)
    : undefined;
  const harness = createCodex(
    subscription
      ? {
          ...settings,
          auth: {},
          codexConfig: {
            ...settings.codexConfig,
            hive_subscription_tokens: placeholder,
          },
        }
      : settings
  );
  const getBootstrap = harness.getBootstrap;
  return {
    ...harness,
    async doStart(options: Parameters<typeof harness.doStart>[0]) {
      if (subscription && placeholder) {
        const session = options.sandboxSession;
        if (
          !("setRequestTransformations" in session) ||
          !session.setRequestTransformations
        ) {
          throw new Error("Codex requires sandbox credential brokering.");
        }
        // Replace stale forwarding rules when resuming an earlier Gateway run.
        await session.setRequestTransformations(
          codexOAuthTransformations(subscription, placeholder)
        );
      }
      const session = await harness.doStart({
        ...options,
        // The framework's global debug sink also prints raw console lines.
        // Forward only our structured request metadata, never sandbox logs.
        observability: {
          debug: {
            enabled: true,
            level: "info",
            subsystems: ["hive.gateway", "hive.subagent", "hive.auth"],
          },
          report(event) {
            if (event.kind === "event" && event.subsystem === "hive.gateway") {
              onGatewayDiagnostic?.(event.attrs ?? {});
            }
            if (event.kind === "event" && event.subsystem === "hive.auth") {
              onGatewayDiagnostic?.({
                event: "authentication",
                ...event.attrs,
              });
            }
            if (event.kind === "event" && event.subsystem === "hive.subagent") {
              const update = subagentUpdateSchema.safeParse(event.attrs);
              if (update.success) onSubagents?.(update.data);
            }
          },
        },
      });
      if (!settings.mcpServers?.hive) return session;
      return {
        ...session,
        doPromptTurn(options: Parameters<typeof session.doPromptTurn>[0]) {
          return session.doPromptTurn({
            ...options,
            prompt: withHiveCodexTools(options.prompt),
          });
        },
      };
    },
    async getBootstrap(...args: Parameters<NonNullable<typeof getBootstrap>>) {
      const recipe = await getBootstrap?.(...args);
      if (!recipe)
        throw new Error("The Codex harness bootstrap is unavailable.");
      // Use the public, self-contained bridge runtime. It depends only on Node
      // and ws, already installed by the unchanged, pinned sandbox recipe.
      const assets = [
        ...["app-server-connection.mjs", "turn-collector.mjs"].map((name) => [
          name,
          path.join(process.cwd(), "src/lib/codex-bridge", name),
        ]),
        [
          "runtime.mjs",
          path.join(process.cwd(), "node_modules/.cache/hive/codex-bridge.mjs"),
        ],
        [
          "bridge.mjs",
          path.join(process.cwd(), "src/lib/codex-bridge/bridge.mjs"),
        ],
        [
          "app-server.mjs",
          path.join(process.cwd(), "src/lib/codex-bridge/app-server.mjs"),
        ],
        ["auth.mjs", path.join(process.cwd(), "src/lib/codex-bridge/auth.mjs")],
        [
          "subagents.mjs",
          path.join(process.cwd(), "src/lib/codex-bridge/subagents.mjs"),
        ],
        [
          "gateway-transport.mjs",
          path.join(
            process.cwd(),
            "src/lib/codex-bridge/gateway-transport.mjs"
          ),
        ],
        [
          "hive-collaboration/SKILL.md",
          path.join(
            process.cwd(),
            "src/lib/codex-bridge/hive-collaboration/SKILL.md"
          ),
        ],
      ];
      const files = await Promise.all(
        assets.map(async ([name, source]) => ({
          path: `${recipe.bootstrapDir}/${name}`,
          content: await readFile(source, "utf8"),
        }))
      );
      return {
        ...recipe,
        files: [
          ...recipe.files.filter(
            (file) => !files.some((asset) => asset.path === file.path)
          ),
          ...files,
        ],
      };
    },
  };
}
