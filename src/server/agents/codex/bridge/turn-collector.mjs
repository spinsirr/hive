export function createTurnCollector(output, expectedThreadId, expectedTurnId) {
  const textByItem = new Map();
  const commands = new Map();
  const completedItems = new Set();
  let turnId = expectedTurnId;
  let tokenUsage, failure, result;
  let observedActivity = false;
  const emit = (event) => {
    if (
      ["text-delta", "tool-call", "tool-result", "file-change"].includes(
        event.type
      )
    )
      observedActivity = true;
    output(event);
  };
  const appendText = (id, delta) => {
    if (!delta || completedItems.has(id)) return;
    if (!textByItem.has(id)) {
      textByItem.set(id, "");
      emit({ type: "text-start", id });
    }
    textByItem.set(id, textByItem.get(id) + delta);
    emit({ type: "text-delta", id, delta });
  };
  const completeCommand = (item) => {
    const command = commands.get(item.id);
    if (!command || completedItems.has(item.id)) return;
    emit({
      type: "tool-result",
      toolCallId: item.id,
      toolName: "bash",
      result: {
        exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null,
        output: item.aggregatedOutput ?? command.output,
        status: item.status,
      },
    });
    completedItems.add(item.id);
  };

  return {
    get observedActivity() {
      return observedActivity;
    },
    get tokenUsage() {
      return tokenUsage;
    },
    get failure() {
      return failure;
    },
    interruptCommands() {
      for (const id of commands.keys())
        completeCommand({ id, status: "interrupted" });
    },
    assertComplete() {
      if ([...commands.keys()].some((id) => !completedItems.has(id)))
        throw new Error("Codex finished without a command's exit status.");
    },
    notification(message) {
      const params = message.params ?? {};
      if (
        params.threadId !== expectedThreadId ||
        (turnId && params.turnId && params.turnId !== turnId)
      )
        return;
      if (message.method === "turn/started") turnId = params.turn.id;
      if (message.method === "item/agentMessage/delta")
        appendText(params.itemId, params.delta);
      if (message.method === "thread/tokenUsage/updated")
        tokenUsage = params.tokenUsage;
      if (message.method === "error" && !params.willRetry)
        failure = params.error;
      if (message.method === "item/commandExecution/outputDelta") {
        const command = commands.get(params.itemId);
        if (command)
          command.output = (command.output + params.delta).slice(0, 20_000);
      }
      if (
        message.method === "item/started" ||
        message.method === "item/completed"
      ) {
        const item = params.item;
        if (!["userMessage", "reasoning", "agentMessage"].includes(item.type))
          observedActivity = true;
        const done = message.method === "item/completed";
        if (completedItems.has(item.id)) return;
        if (item.type === "agentMessage") {
          const previous = textByItem.get(item.id) ?? "";
          if (done) {
            if (!item.text.startsWith(previous))
              throw new Error(
                "Codex's completed reply differs from its streamed text."
              );
            appendText(item.id, item.text.slice(previous.length));
            if (textByItem.has(item.id))
              emit({ type: "text-end", id: item.id });
            completedItems.add(item.id);
          }
        } else if (item.type === "commandExecution") {
          if (!commands.has(item.id)) {
            commands.set(item.id, { output: "" });
            emit({
              type: "tool-call",
              toolCallId: item.id,
              toolName: "bash",
              nativeName: "shell",
              input: JSON.stringify({ command: item.command }),
              providerExecuted: true,
            });
          }
          if (done) completeCommand(item);
        } else if (
          item.type === "fileChange" &&
          done &&
          item.status === "completed"
        ) {
          for (const change of item.changes)
            emit({
              type: "file-change",
              path: change.path,
              event:
                change.kind.type === "add"
                  ? "create"
                  : change.kind.type === "delete"
                    ? "delete"
                    : "modify",
            });
          completedItems.add(item.id);
        } else if (item.type === "mcpToolCall") {
          if (!done)
            emit({
              type: "tool-call",
              toolCallId: item.id,
              toolName: item.tool,
              input: JSON.stringify(item.arguments),
              providerExecuted: true,
              dynamic: true,
            });
          else {
            emit({
              type: "tool-result",
              toolCallId: item.id,
              toolName: item.tool,
              result: item.error ?? item.result,
              dynamic: true,
            });
            completedItems.add(item.id);
          }
        }
        // Reasoning is deliberately not translated into public text.
      }
      if (message.method === "turn/completed") {
        result = params.turn;
        return result;
      }
    },
  };
}
