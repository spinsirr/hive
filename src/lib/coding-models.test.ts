import assert from "node:assert/strict";
import test from "node:test";
import {
  codexModel,
  codingModelOptions,
  CODEX_GATEWAY_MODEL,
  CODEX_SUBSCRIPTION_MODEL,
  modelEffort,
  selectedCodingModel,
} from "./coding-models.ts";

test("displayed Codex choice uses the same configured model as the runner", () => {
  assert.equal(codexModel(), CODEX_GATEWAY_MODEL);
  assert.equal(codexModel("  "), CODEX_GATEWAY_MODEL);
  assert.equal(codexModel(" custom/model "), "custom/model");
  assert.equal(codexModel("custom/model", true), CODEX_SUBSCRIPTION_MODEL);
  assert.deepEqual(codingModelOptions(codexModel())[0], {
    runtime: "codex",
    modelId: CODEX_GATEWAY_MODEL,
    label: "GPT-5.1 Codex Mini",
    efforts: ["low", "medium", "high"],
  });
  assert.equal(
    selectedCodingModel(
      codingModelOptions(codexModel(undefined, true)),
      "codex"
    )?.label,
    "GPT-5.6 Luna"
  );
  assert.equal(
    codingModelOptions(codexModel("custom/model"))[0].label,
    "custom/model",
    "unknown configurations must not pretend to be a default model"
  );
  assert.deepEqual(codingModelOptions(codexModel())[1], {
    runtime: "claude-code",
    modelId: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    efforts: ["low", "medium", "high"],
    thinking: "adaptive",
  });
});

test("Codex display order preserves Luna as default and honors explicit selections", () => {
  const models = codingModelOptions(CODEX_SUBSCRIPTION_MODEL, true);
  assert.deepEqual(
    models
      .filter((model) => model.runtime === "codex")
      .map((model) => model.label),
    ["GPT-6 Astra", "GPT-5.6 Sol", "GPT-5.6 Luna"]
  );
  for (const catalog of [models, [...models].reverse()]) {
    assert.equal(
      selectedCodingModel(catalog, "codex")?.modelId,
      CODEX_SUBSCRIPTION_MODEL
    );
    for (const modelId of [
      "gpt-6-astra",
      "gpt-5.6-sol",
      CODEX_SUBSCRIPTION_MODEL,
    ]) {
      assert.equal(
        selectedCodingModel(catalog, "codex", modelId)?.modelId,
        modelId
      );
    }
  }
  assert.equal(
    selectedCodingModel(codingModelOptions(CODEX_GATEWAY_MODEL), "codex")
      ?.modelId,
    CODEX_GATEWAY_MODEL
  );
  assert.equal(
    selectedCodingModel(codingModelOptions("custom/model"), "codex")?.modelId,
    "custom/model"
  );
  assert.equal(
    selectedCodingModel(models, "codex", "unknown-model"),
    undefined
  );
});

test("subscription choices use native IDs and model-specific effort, never Gateway entitlements", () => {
  const models = codingModelOptions(CODEX_SUBSCRIPTION_MODEL, true);
  assert.equal(
    new Set(models.map((model) => model.modelId)).size,
    models.length
  );
  assert.ok(models.every((model) => !model.modelId.includes("/")));
  assert.deepEqual(
    models
      .filter((model) => model.runtime === "claude-code")
      .map((model) => model.label),
    [
      "Claude Fable 5",
      "Claude Opus 4.6",
      "Claude Sonnet 4.6",
      "Claude Haiku 4.5",
    ]
  );
  const sonnet = selectedCodingModel(models, "claude-code")!;
  assert.equal(
    sonnet.modelId,
    "claude-sonnet-4-6",
    "Changing display order must keep Sonnet as the default"
  );
  assert.equal(
    selectedCodingModel([...models].reverse(), "claude-code")?.modelId,
    sonnet.modelId
  );
  const opus = selectedCodingModel(models, "claude-code", "claude-opus-4-6")!;
  const haiku = selectedCodingModel(models, "claude-code", "claude-haiku-4-5")!;
  const fable = selectedCodingModel(models, "claude-code", "claude-fable-5")!;
  assert.deepEqual(fable.efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(fable.thinking, "adaptive-required");
  assert.match(fable.notice!, /credits/);
  assert.equal(
    models.some((model) => model.modelId === "claude-fable-5-1"),
    false,
    "The pinned official harness does not yet bundle a runtime supporting Fable 5.1"
  );
  assert.deepEqual(sonnet.efforts, ["low", "medium", "high", "max"]);
  assert.deepEqual(opus.efforts, sonnet.efforts);
  assert.deepEqual(haiku.efforts, []);
  assert.equal(modelEffort(haiku, "high"), undefined);
  assert.equal(modelEffort(opus, "xhigh"), "low");
  assert.equal(modelEffort(opus, "max"), "max");
  assert.equal(selectedCodingModel(models, "codex", opus.modelId), undefined);
  assert.equal(
    selectedCodingModel(models, "claude-code", "unknown-model"),
    undefined
  );
  assert.equal(
    selectedCodingModel(models, "codex")?.modelId,
    CODEX_SUBSCRIPTION_MODEL
  );
});
