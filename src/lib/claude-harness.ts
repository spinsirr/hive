import { randomUUID } from "node:crypto";
import { createClaudeCode, type ClaudeCodeHarnessSettings } from "@ai-sdk/harness-claude-code";
import type { HarnessV1RequestTransformation } from "@ai-sdk/harness";

export const CLAUDE_GATEWAY_MODEL = "anthropic/claude-sonnet-4.6";
export const CLAUDE_SUBSCRIPTION_MODEL = "claude-sonnet-4-6";

/** Only the Sandbox egress layer receives this credential, never the VM. */
export function claudeOAuthTransformations(token: string, placeholder: string): HarnessV1RequestTransformation[] {
  return ["/v1/messages", "/v1/messages/count_tokens"].map((path) => ({
    match: {
      host: "api.anthropic.com", path: { exact: path }, method: ["POST"],
      headers: [{ key: { exact: "authorization" }, value: { exact: `Bearer ${placeholder}` } }],
    },
    transform: { headers: { Authorization: `Bearer ${token}` } },
  }));
}

export function createHiveClaude(settings: {
  gatewayAuth: NonNullable<ClaudeCodeHarnessSettings["auth"]>;
  subscriptionToken?: string;
  mcpServers?: ClaudeCodeHarnessSettings["mcpServers"];
}) {
  const placeholder = settings.subscriptionToken ? `sk-ant-oat01-hive-${randomUUID()}` : "";
  const harness = createClaudeCode({
    // Passing auth explicitly prevents discovery of the host's Claude login/helper.
    auth: settings.subscriptionToken ? {} : settings.gatewayAuth,
    mcpServers: settings.mcpServers,
    maxTurns: 30,
    thinking: { type: "disabled" },
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: placeholder,
      CLAUDE_CODE_USE_BEDROCK: "", CLAUDE_CODE_USE_VERTEX: "", CLAUDE_CODE_USE_FOUNDRY: "",
      ANTHROPIC_CUSTOM_HEADERS: "",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ...(settings.subscriptionToken ? {
        // Do not pass empty API-key variables: the upstream broker replaces
        // even empty strings with placeholders, which would override OAuth.
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      } : {}),
    },
  });
  return {
    ...harness,
    async doStart(options: Parameters<typeof harness.doStart>[0]) {
      const previous = (options.continueFrom ?? options.resumeFrom)?.data;
      if (settings.subscriptionToken && previous && typeof previous === "object" &&
        "sandboxCredentialEnvironment" in previous && previous.sandboxCredentialEnvironment &&
        Object.keys(previous.sandboxCredentialEnvironment).length > 0) {
        throw new Error("Start a new Claude task to change authentication without mixing credentials.");
      }
      const session = options.sandboxSession;
      if (!("addRequestTransformations" in session) || !session.addRequestTransformations) {
        throw new Error("Claude requires sandbox credential brokering; credentials will not be forwarded to the VM.");
      }
      if (settings.subscriptionToken) {
        await session.addRequestTransformations(claudeOAuthTransformations(settings.subscriptionToken, placeholder));
      }
      return harness.doStart(options);
    },
  };
}
