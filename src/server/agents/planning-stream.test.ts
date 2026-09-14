import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { consumePlanningText } from "./planning-stream.ts";

const receipt = {
  messageId: "peer-question",
  created: true,
  status: "awaiting_answer",
};
const text = (value: string) => ({ type: "text-delta", text: value });
async function* parts(
  values: {
    type: string;
    text?: string;
    error?: unknown;
    toolName?: string;
    output?: unknown;
    input?: unknown;
  }[]
) {
  yield* values;
}

test("the installed Claude bridge preserves the captured native MCP content array", async () => {
  // Replay the SDK message shape observed in the isolated production QA task,
  // using the installed bridge instead of assuming its tool-result format.
  const source = await readFile(
    new URL(
      "../../../node_modules/@ai-sdk/harness-claude-code/src/bridge/create-emit-stream-event.ts",
      import.meta.url
    ),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const { createClaudeStreamEventState, createEmitStreamEvent } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
  const events: {
    type: string;
    toolName?: string;
    result?: unknown;
    delta?: string;
  }[] = [];
  const emit = createEmitStreamEvent({
    state: createClaudeStreamEventState(),
    emit: (event: (typeof events)[number]) => events.push(event),
    emitWarning: () => {},
    emitTerminalError: () => {},
    onCompactionBoundary: () => {},
    toCommonName: (name: string) => name,
  });
  const content = [{ type: "text", text: JSON.stringify(receipt) }];
  emit({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "question-tool",
          name: "mcp__hive__request_input",
          input: {},
        },
      ],
    },
  });
  emit({
    type: "user",
    tool_use_result: content,
    message: {
      content: [{ type: "tool_result", tool_use_id: "question-tool", content }],
    },
  });
  emit({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    },
  });
  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Detailed" },
    },
  });
  assert.deepEqual(
    events.find((event) => event.type === "tool-result")?.result,
    content
  );
  // Harness maps result -> output and delta -> text in its public fullStream.
  const stream = parts(
    events.map((event) => ({
      ...event,
      output: event.result,
      text: event.delta,
    }))
  );
  assert.equal(
    await consumePlanningText(stream, () =>
      assert.fail("Do not publish the invented answer")
    ),
    ""
  );
});

test("a confirmed planning question ends public prose, not the native stream", async () => {
  for (const toolName of ["request_input", "mcp__hive__request_input"]) {
    for (const output of [
      receipt,
      { content: [{ type: "text", text: JSON.stringify(receipt) }] },
      [{ type: "text", text: JSON.stringify(receipt) }],
    ]) {
      let drained = false;
      const visible: string[] = [];
      async function* stream() {
        yield text("The original codename was Lantern.");
        yield { type: "tool-result", toolName, output };
        yield { type: "text-start", id: "extra" };
        yield text('["Close after navigation"]');
        yield text("I asked the question.");
        drained = true;
        yield { type: "finish" };
      }
      assert.equal(
        await consumePlanningText(stream(), (value) => visible.push(value)),
        "The original codename was Lantern."
      );
      assert.deepEqual(visible, ["The original codename was Lantern."]);
      assert.equal(
        drained,
        true,
        "the native turn must finish before parking its context"
      );
    }
  }
});

test("ordinary text, answered/rejected requests and unrelated tools are never swallowed", async () => {
  for (const part of [
    { type: "tool-call", toolName: "request_input", input: receipt },
    { type: "tool-result", toolName: "unrelated", output: receipt },
    {
      type: "tool-result",
      toolName: "request_input",
      output: { ...receipt, status: "answered" },
    },
    {
      type: "tool-result",
      toolName: "request_input",
      output: { status: "awaiting_answer" },
    },
    {
      type: "tool-result",
      toolName: "request_input",
      output: { ...receipt, isError: true },
    },
    {
      type: "tool-result",
      toolName: "request_input",
      output: { content: [{ type: "text", text: "malformed receipt" }] },
    },
    {
      type: "tool-result",
      toolName: "request_input",
      output: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(receipt) }],
      },
    },
  ])
    assert.equal(
      await consumePlanningText(
        parts([part, text("A real limitation.")]),
        () => {}
      ),
      "A real limitation."
    );
  assert.equal(
    await consumePlanningText(
      parts([text('["valid JSON response"]')]),
      () => {}
    ),
    '["valid JSON response"]',
    "do not filter prose by its syntax"
  );
});

test("question boundaries preserve late failures and the next answer's independent reply", async () => {
  const question = {
    type: "tool-result",
    toolName: "request_input",
    output: receipt,
  };
  const error = new Error("Native stream disconnected");
  await assert.rejects(
    consumePlanningText(parts([question, { type: "error", error }]), () => {}),
    error
  );
  await assert.rejects(
    consumePlanningText(parts([question, { type: "abort" }]), () => {}),
    /interrupted/
  );
  assert.equal(
    await consumePlanningText(
      parts([question, { type: "tool-error" }, text("A tool failed.")]),
      () => {}
    ),
    "A tool failed."
  );
  assert.equal(
    await consumePlanningText(
      parts([
        question,
        {
          type: "tool-result",
          toolName: "reply_to_thread",
          output: {
            isError: true,
            content: [{ type: "text", text: "Failure" }],
          },
        },
        text("A tool failed."),
      ]),
      () => {}
    ),
    "A tool failed."
  );
  assert.equal(
    await consumePlanningText(parts([text("You chose Stay open.")]), () => {}),
    "You chose Stay open."
  );
});
