import type { CodingRuntime } from "../session/task-session.ts";
import type { CodingEffort } from "./coding-effort.ts";

export const CODEX_GATEWAY_MODEL = "openai/gpt-5.1-codex-mini";
export const CODEX_SUBSCRIPTION_MODEL = "gpt-5.6-luna";
export const CLAUDE_GATEWAY_MODEL = "anthropic/claude-sonnet-4.6";
export const CLAUDE_SUBSCRIPTION_MODEL = "claude-sonnet-4-6";

export type CodingModelOption = {
  runtime: CodingRuntime;
  modelId: string;
  label: string;
  efforts: CodingEffort[];
  /** Empty efforts means the runtime must omit effort, not send a fake Low. */
  thinking?: "adaptive" | "adaptive-required" | "disabled";
  notice?: string;
};

export function codexModel(gatewayModel?: string, preferSubscription = false) {
  return preferSubscription
    ? CODEX_SUBSCRIPTION_MODEL
    : gatewayModel?.trim() || CODEX_GATEWAY_MODEL;
}

/**
 * Hive's deliberately bounded, pinned model support (not account entitlements).
 * Native Claude capabilities: https://platform.claude.com/docs/en/build-with-claude/effort
 * Keep Gateway and subscription IDs/capabilities separate. Do not replace these
 * with the Gateway catalog for subscription sessions.
 */
export function codingModelOptions(
  codexModelId: string,
  claudeSubscription = false
): CodingModelOption[] {
  const names: Record<string, string> = {
    [CODEX_GATEWAY_MODEL]: "GPT-5.1 Codex Mini",
    [CODEX_SUBSCRIPTION_MODEL]: "GPT-5.6 Luna",
  };
  const codex: CodingModelOption[] =
    codexModelId === CODEX_SUBSCRIPTION_MODEL
      ? [
          {
            runtime: "codex",
            modelId: "gpt-6-astra",
            label: "GPT-6 Astra",
            efforts: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            runtime: "codex",
            modelId: "gpt-5.6-sol",
            label: "GPT-5.6 Sol",
            efforts: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            runtime: "codex",
            modelId: CODEX_SUBSCRIPTION_MODEL,
            label: names[CODEX_SUBSCRIPTION_MODEL],
            efforts: ["low", "medium", "high", "xhigh", "max"],
          },
        ]
      : [
          {
            runtime: "codex",
            modelId: codexModelId,
            label: names[codexModelId] ?? codexModelId,
            efforts: ["low", "medium", "high"],
          },
        ];
  const claude: CodingModelOption[] = claudeSubscription
    ? [
        {
          runtime: "claude-code",
          modelId: "claude-fable-5",
          label: "Claude Fable 5",
          efforts: ["low", "medium", "high", "xhigh", "max"],
          thinking: "adaptive-required",
          notice: "May use additional usage credits",
        },
        {
          runtime: "claude-code",
          modelId: "claude-opus-4-6",
          label: "Claude Opus 4.6",
          efforts: ["low", "medium", "high", "max"],
          thinking: "adaptive",
        },
        {
          runtime: "claude-code",
          modelId: CLAUDE_SUBSCRIPTION_MODEL,
          label: "Claude Sonnet 4.6",
          efforts: ["low", "medium", "high", "max"],
          thinking: "adaptive",
        },
        {
          runtime: "claude-code",
          modelId: "claude-haiku-4-5",
          label: "Claude Haiku 4.5",
          efforts: [],
          thinking: "disabled",
        },
      ]
    : [
        {
          runtime: "claude-code",
          modelId: CLAUDE_GATEWAY_MODEL,
          label: "Claude Sonnet 4.6",
          efforts: ["low", "medium", "high"],
          thinking: "adaptive",
        },
      ];
  return [...codex, ...claude];
}

export function selectedCodingModel(
  models: CodingModelOption[],
  runtime: CodingRuntime,
  modelId?: string
) {
  if (modelId)
    return models.find(
      (model) => model.runtime === runtime && model.modelId === modelId
    );
  // Display order must not change the defaults (Luna / Sonnet) or opt into a pricier model.
  const defaultModel = models.find(
    (model) =>
      model.runtime === runtime &&
      (runtime === "codex"
        ? model.modelId === CODEX_SUBSCRIPTION_MODEL
        : model.modelId === CLAUDE_SUBSCRIPTION_MODEL ||
          model.modelId === CLAUDE_GATEWAY_MODEL)
  );
  return defaultModel ?? models.find((model) => model.runtime === runtime);
}

export function modelEffort(
  model: CodingModelOption,
  effort?: CodingEffort
): CodingEffort | undefined {
  return effort && model.efforts.includes(effort) ? effort : model.efforts[0];
}
