// Exercise the real pre-repository runner; only the model service is doubled.
// Run with: node --experimental-test-module-mocks scripts/check-conversation-input.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { APICallError, dynamicTool, jsonSchema, hasToolCall, stepCountIs } from "ai";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

let modelInput;
mock.module("ai", { namedExports: {
  APICallError,
  dynamicTool, jsonSchema, hasToolCall, stepCountIs,
  streamText(input) {
    modelInput = input;
    return {
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Discussing the selected annotation." };
      })(),
      text: Promise.resolve("Discussing the selected annotation."),
    };
  },
} });

const { runHiveConversation } = await import("../src/lib/hive-conversation.ts");
const { buildHiveRunInput } = await import("../src/lib/hive-prompt.ts");
const { appendHiveReply, createInitialTaskSessionState, reduceTaskSession } = await import("../src/lib/task-session.ts");
const members = [
  { id: "github-101", name: "Ada", shortName: "Ada", initials: "AD" },
  { id: "github-202", name: "Grace", shortName: "Grace", initials: "GR" },
];
let state = reduceTaskSession(createInitialTaskSessionState(1), {
  type: "send-message", actor: "github-101", body: "Discuss the accessible label",
}, 2, members);
const parent = state.messages.at(-1);
state = reduceTaskSession(state, {
  type: "annotate-message", actor: "github-202", messageId: parent.id,
  body: "Preserve the annotation author's name",
}, 3, members);
state = reduceTaskSession(state, {
  type: "steer-message-annotation", actor: "github-202", messageId: parent.id,
  annotationId: state.messages.at(-1).annotations[0].id,
}, 4, members);
state = appendHiveReply(state, "The preceding discussion finished", 5);
const action = { type: "apply-next-steer", actor: "github-101" };
state = reduceTaskSession(state, action, 6, members);
const input = buildHiveRunInput(state, action, members);
const publicText = [];
const reply = await runHiveConversation(
  state, input.actor, input.actorName, (body) => publicText.push(body), input.steer,
);

assert.match(modelInput.prompt, /Latest request to discuss:/);
assert.match(modelInput.prompt, /Annotation author: Grace/);
assert.match(modelInput.prompt, /Run started by: Ada/);
assert.match(modelInput.prompt, /Annotation to execute:\nPreserve the annotation author's name/);
assert.equal(modelInput.providerOptions.gateway.user, "github-202");
assert.deepEqual(publicText, [reply]);
console.log("PASS: the pre-repository runner forwards the selected attributed steer to the model");
