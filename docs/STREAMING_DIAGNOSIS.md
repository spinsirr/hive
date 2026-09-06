# Codex text streaming — known limitation

Status: diagnosed, not fixed. Checked September 6, 2026.

## Production observation

The formal task's 07:40:50 UTC request was observed continuously through one browser call, not separate snapshots taken after generation. The first visible response at 07:41:20.941 contained 1,249 characters, including the check results, while Complete was still disabled. At 07:41:27.417 it contained 1,257 characters and the run had finished; the change was formatting, not a growing answer. The acceptance assertion failed: only one in-progress text update was observed, not at least two substantive increments.

This is a failed typing-effect check. It is not a failure of the separately verified multiplayer message synchronization or reconnect behavior. No extra model request was sent after this observation timeout/failure. The same run's actual combined command was later expanded in Runs: 92 tests passed, type generation/TypeScript succeeded, and the command was marked Passed. The real one-line diff remains.

## Isolated boundary

Hive uses `@ai-sdk/harness-codex` 1.0.100, whose sandbox bridge pins `@openai/codex-sdk` 0.149.1. Inspection of that exact Codex release established:

- The [TypeScript SDK](https://github.com/openai/codex/blob/rust-v0.149.1/sdk/typescript/src/exec.ts) launches `codex exec --experimental-json` and yields its JSONL events.
- The [JSONL processor](https://github.com/openai/codex/blob/rust-v0.149.1/codex-rs/exec/src/event_processor_with_jsonl_output.rs) omits agent-message starts, emits the completed agent message, and does not forward agent-message delta notifications. Its `item.updated` path concerns plan updates, not public text.
- The installed harness adapter can turn cumulative `item.updated` text into deltas, but this SDK event source does not supply those text updates. The published adapter 1.0.104 was also inspected without installing it; its turn driver still uses the same SDK `runStreamed` path. A package upgrade alone is not the fix.

The [official Codex documentation](https://developers.openai.com/codex/sdk/) points custom streaming clients to app-server. Its [agent-message delta notification](https://learn.chatgpt.com/docs/app-server#events) is the appropriate public-text event, distinct from reasoning and tool output.

## Controlled diagnostic

`scripts/diagnostics/check-harness-stream.mjs` runs the **installed** Codex event adapter and step tracker through the **real** HarnessAgent and Hive's text consumer/checkpoint writer. It supplies controlled source events and an inert sandbox boundary; it does not call a model, execute shell commands, or use credentials or a database.

```bash
node scripts/diagnostics/check-harness-stream.mjs
# PASS: two checkpoints arrive before the final message.

node scripts/diagnostics/check-harness-stream.mjs --completed-only
# Expected assertion failure: a completed-only source cannot grow public text.
```

This is a differential diagnostic of the event boundary, not a production SDK trace or an end-to-end regression. It deliberately reads installed adapter internals and is not part of the normal test suite. It excludes buffering inside HarnessAgent/the Hive writer as an explanation when genuine updates are provided. Separate transport tests do not establish model-token cadence.

## Scope decision still required

Do not add a fake typing animation or claim character streaming is finished. Supporting native deltas requires changing the Codex event transport, while preserving the existing harness lifecycle, saved thread identity, Gateway authentication, tool results, and failure checkpoints. That change needs a focused implementation and recovery retest, not a CSS adjustment.

No production runtime, dependency, model, authentication, billing, saved history, or repository artifact was changed during this diagnosis. Decide with the owner whether to make that transport change now or explicitly defer the typing effect while finishing the bounded multiplayer demo.
