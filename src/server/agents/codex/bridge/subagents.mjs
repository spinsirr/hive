import { randomUUID, createHash } from "node:crypto";
import { chmod } from "node:fs/promises";
import { createServer } from "node:net";

const terminal = new Set(["completed", "failed", "stopped", "unconfirmed"]);
const MAX_TASKS = 2;
const MAX_RESULT = 12_000;

export function subagentSocket(capability) {
  return `/tmp/hive-${createHash("sha256").update(capability).digest("hex").slice(0, 32)}.sock`;
}

/** Share the current task's configuration; only the delegated role is different. */
export function subagentSettings(settings) {
  return {
    ...settings,
    ephemeral: true,
    config: {
      ...settings.config,
      // Native review must use the selected task model, not a separate default.
      review_model: settings.model,
    },
    developerInstructions: [
      settings.developerInstructions,
      "You are Hive's delegated research/review agent in the same task and repository. Use the task's available tools and skills when relevant, following the same authorization and memory rules as Hive. Inspect and report; do not edit files, start additional work, or act on queued messages. Return concise evidence with file paths and line numbers to the parent agent. The working copy is shared and may change, so distinguish what you inspected from assumptions.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** The controller only exposes three bounded operations, never arbitrary RPC. */
export function createSubagents({
  request,
  settings,
  runId,
  onChange,
  timeoutMs = 120_000,
}) {
  const tasks = new Map();
  let closed = false;
  let sequence = 0;
  const publicTask = ({
    id,
    runId,
    requestId,
    kind,
    task,
    status,
    startedAt,
    completedAt,
    threadId,
    turnId,
    result,
  }) => ({
    id,
    runId,
    requestId,
    kind,
    task,
    status,
    startedAt,
    completedAt,
    threadId,
    turnId,
    result,
  });
  const snapshot = () => [...tasks.values()].map(publicTask);
  function changed(task) {
    onChange({ runId, sequence: ++sequence, tasks: snapshot() });
    for (const resolve of task.listeners) resolve();
    task.listeners.clear();
    if (terminal.has(task.status)) clearTimeout(task.timer);
  }
  function get(id) {
    const task = tasks.get(id);
    if (!task) throw new Error("Subagent does not belong to this run.");
    return task;
  }
  async function stop(task) {
    if (terminal.has(task.status) || task.status === "stopping")
      return publicTask(task);
    task.status = "stopping";
    changed(task);
    if (task.threadId && task.turnId) {
      try {
        await request("turn/interrupt", {
          threadId: task.threadId,
          turnId: task.turnId,
        });
      } catch {
        if (!terminal.has(task.status)) {
          task.status = "unconfirmed";
          changed(task);
        }
      }
    }
    // An interrupt acknowledgement is NOT a terminal result.
    return publicTask(task);
  }
  async function wait(task, ms) {
    if (terminal.has(task.status)) return;
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        task.listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      task.listeners.add(done);
    });
  }
  return {
    snapshot,
    ownsThread(threadId) {
      return [...tasks.values()].some((task) => task.threadId === threadId);
    },
    async control(input) {
      if (closed) throw new Error("This run has ended.");
      if (input.action === "spawn") {
        if (
          !["research", "review"].includes(input.kind) ||
          typeof input.task !== "string" ||
          !input.task.trim() ||
          input.task.length > 4000 ||
          typeof input.requestId !== "string" ||
          !input.requestId ||
          input.requestId.length > 200
        )
          throw new Error("Invalid delegation.");
        // The stable delegation key survives MCP retries and client reconnections.
        const previous = [...tasks.values()].find(
          (task) => task.requestId === input.requestId
        );
        if (previous) {
          if (previous.task !== input.task || previous.kind !== input.kind)
            throw new Error("Delegation ID already used.");
          return publicTask(previous);
        }
        if (tasks.size >= MAX_TASKS)
          throw new Error(
            "At most two subagents may be started per Hive turn."
          );
        const task = {
          id: randomUUID(),
          runId,
          requestId: input.requestId,
          kind: input.kind,
          task: input.task,
          status: "starting",
          startedAt: Date.now(),
          result: "",
          listeners: new Set(),
          completedItems: new Set(),
        };
        tasks.set(task.id, task);
        changed(task);
        try {
          const response = await request(
            "thread/start",
            subagentSettings(settings)
          );
          task.threadId = response.thread.id;
          if (closed || task.status === "stopping") {
            task.status = "stopped";
            changed(task);
            return publicTask(task);
          }
          const started =
            task.kind === "review"
              ? await request("review/start", {
                  threadId: task.threadId,
                  delivery: "inline",
                  target: { type: "custom", instructions: task.task },
                })
              : await request("turn/start", {
                  threadId: task.threadId,
                  input: [{ type: "text", text: task.task, text_elements: [] }],
                });
          task.turnId = started.turn.id;
          if (task.status === "starting") {
            task.status = "running";
            changed(task);
          }
          if (closed || task.status === "stopping") {
            if (!terminal.has(task.status))
              await request("turn/interrupt", {
                threadId: task.threadId,
                turnId: task.turnId,
              });
          } else if (!terminal.has(task.status)) {
            task.timer = setTimeout(() => {
              void stop(task);
            }, timeoutMs);
          }
        } catch {
          if (!terminal.has(task.status)) {
            task.status = task.status === "stopping" ? "unconfirmed" : "failed";
            changed(task);
          }
        }
        return publicTask(task);
      }
      const task = get(input.id);
      if (input.action === "stop") return stop(task);
      if (input.action === "read") {
        await wait(
          task,
          Math.min(Math.max(Number(input.waitMs) || 0, 0), 10_000)
        );
        return publicTask(task);
      }
      throw new Error("Unsupported subagent operation.");
    },
    notification({ method, params }) {
      const task = [...tasks.values()].find(
        (candidate) => candidate.threadId === params?.threadId
      );
      const eventTurnId = params?.turnId ?? params?.turn?.id;
      // Native review may emit an internal turn's lifecycle on the same thread.
      // Only the turn returned by review/start owns this task and its result.
      if (
        !task ||
        terminal.has(task.status) ||
        (task.turnId && eventTurnId && eventTurnId !== task.turnId)
      )
        return;
      if (method === "turn/started") {
        task.turnId ??= params.turn.id;
      }
      if (method === "item/completed") {
        const item = params.item;
        if (task.completedItems.has(item.id)) return;
        task.completedItems.add(item.id);
        // Native review results have their own item type; never reuse tool output.
        const text =
          item.type === "exitedReviewMode"
            ? item.review
            : item.type === "agentMessage" && task.kind === "research"
              ? item.text
              : "";
        if (text)
          task.result = [task.result, text]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, MAX_RESULT);
      }
      if (method === "turn/completed") {
        task.status =
          params.turn.status === "completed"
            ? "completed"
            : params.turn.status === "interrupted"
              ? "stopped"
              : "failed";
        task.completedAt = Date.now();
        changed(task);
      }
    },
    async close() {
      closed = true;
      await Promise.all(
        [...tasks.values()].map(async (task) => {
          await stop(task);
          const deadline = Date.now() + 4000;
          while (!terminal.has(task.status) && Date.now() < deadline)
            await wait(task, deadline - Date.now());
          if (!terminal.has(task.status)) {
            task.status = "unconfirmed";
            changed(task);
          }
        })
      );
    },
  };
}

/** Private, run-scoped IPC inside the existing VM; no additional public port. */
export async function serveSubagents(controller, capability) {
  const socketPath = subagentSocket(capability);
  const connections = new Set();
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    connections.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => connections.delete(socket));
    socket.setTimeout(15_000, () => socket.destroy());
    let body = "";
    let received = false;
    socket.on("data", (data) => {
      if (received) return;
      body += data.toString();
      if (body.length > 16_384) {
        socket.destroy();
        return;
      }
      if (!body.includes("\n")) return;
      received = true;
      void (async () => {
        try {
          const input = JSON.parse(body.trim());
          if (input.capability !== capability) throw new Error("Unauthorized.");
          socket.end(
            `${JSON.stringify({ result: await controller.control(input) })}\n`
          );
        } catch (error) {
          socket.end(`${JSON.stringify({ error: error.message })}\n`);
        }
      })();
    });
  });
  // Bind must fail closed if another process already owns this run's socket.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  return async () => {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  };
}
