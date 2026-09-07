import { parseArgs } from "node:util";
import { runBridge } from "./runtime.mjs";
import { runCodexAppServerTurn } from "./app-server.mjs";

const { values } = parseArgs({ options: {
  workdir: { type: "string" },
  "bridge-state-dir": { type: "string" },
  "cli-shim-dir": { type: "string" },
} });
if (!values.workdir || !values["bridge-state-dir"]) throw new Error("Codex bridge directories are required.");
let threadId;
let currentTurn;
let controller;
async function drain() {
  controller?.abort();
  await currentTurn?.catch(() => {});
}
await runBridge({
  bridgeType: "codex",
  bridgeStateDir: values["bridge-state-dir"],
  async onStart(start, turn) {
    controller = new AbortController();
    currentTurn = runCodexAppServerTurn({
      start,
      turn: { ...turn, abortSignal: AbortSignal.any([turn.abortSignal, controller.signal]) },
      workdir: values.workdir,
      threadId: start.restartThread ? undefined : start.resumeThreadId || threadId,
      onThread(id) { threadId = id; },
    });
    try { await currentTurn; } finally { controller = undefined; }
  },
  async onStop() { await drain(); return threadId ? { threadId } : {}; },
  onDestroy: drain,
});
