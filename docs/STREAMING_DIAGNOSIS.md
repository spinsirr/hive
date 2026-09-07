# Codex text streaming — diagnosis and native transport

Status: native transport deployed; production incremental-text acceptance passed at **2026-09-07 00:19 UTC** (September 6 locally). The failed observation below is retained as before-fix evidence.

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

## Native transport implementation

The owner authorized implementation. `createHiveCodex` keeps the installed Vercel harness adapter's lifecycle, authentication and saved thread identity; only its public bootstrap recipe's sandbox driver changes. The public `@ai-sdk/harness/bridge` runtime still owns authenticated WebSockets, sequence/replay and lifecycle files. A build-time asset copy avoids importing sandbox code into Next's bundle. No dependencies, Codex/model versions, credentials, billing settings or task data are changed.

The driver uses Codex app-server's **stdio** protocol, not an exposed app-server WebSocket. It initializes, starts/resumes the existing native thread, and starts one turn. Public `item/agentMessage/delta` events pass through immediately; the completed item contributes only its missing suffix. Reasoning and unrelated-thread events never become chat text. Commands retain their actual output and exit code; unfinished commands keep partial output with an unknown exit code on failure. EOF and a bounded shutdown precede the sandbox snapshot. Unexpected interactive requests fail rather than silently gaining approval. Hive does not currently supply host-executed tools; unsupported ones are rejected explicitly.

The protocol is checked against [Codex 0.149.1's request schemas](https://github.com/openai/codex/tree/rust-v0.149.1/codex-rs/app-server-protocol/schema/typescript/v2). Native usage notifications expose cumulative thread totals and the last model call, so they are retained as raw counters rather than mislabeled as an exact total for a multi-call turn.

Validation:

- `node scripts/check-native-stream.mjs`: controlled external stdio process, real HarnessAgent and Hive checkpoint writer. Two increments arrive before completion; no duplicate suffix, reasoning or other-thread text; fresh-process resume and failed-command evidence pass. Included in `pnpm test`.
- `node scripts/diagnostics/check-codex-process.mjs <isolated-sdk-install>`: opt-in real CLI **0.149.1** against a loopback-only Responses fixture. Native deltas passed; a second process resumed the on-disk thread and sent its original marker in the next model request; one actual `printf native-check` returned exit 0 and its output reached the next model call. No account credentials or paid model were used.
- Existing 98 unit tests, seven failed-run scenarios, pre-repository input regression, TypeScript and ESLint pass. The supported webpack production build passes and includes all three sandbox assets in the session route's deployment trace. Default local Turbopack still fails on its port-binding permission; its configuration is unchanged.

## Production acceptance after the change

Commit `4a1abb3` received a successful Vercel status for deployment `FEK7aAcWYRPv6eVuGptwxcBD2m4X`. In the canonical app's existing formal task, one new explanation-plus-read-only-check request was submitted. No retry, reset or replacement task was used.

A continuous browser observer recorded **25 strictly growing in-progress updates**, from **32 to 1,148 displayed characters**, between **00:19:28.481 and 00:19:36.081 UTC**. Complete remained disabled during every observation. A screenshot at the first update showed only the beginning of the answer. After completion, there was exactly one new agent reply (18 → 19), containing 1,148 displayed characters.

Runs contained one actual `/bin/bash -lc 'pnpm test && pnpm typecheck && git diff --check'`, marked Passed. Expanded output showed **92 tests passed / 0 failed** for the preserved sandbox revision, followed by successful type generation/TypeScript. The original accessible-label diff (`8cf1187..3624515`) and Files snapshot remained. A fresh page restored all 19 replies and the identical final text, reached Live, and had Complete enabled without submitting any work.

This closes the native incremental-text gate on production. It is not a new two-account/offline-mid-delta test: those earlier multiplayer and human-message recovery checks remain separately recorded. No additional model request was made to repeat them.
