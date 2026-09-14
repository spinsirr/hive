# Vercel Harness decision

Current compatibility record checked: 2026-09-10 (local installed packages).
The original September 2 migration proposal is retained below as history.

## Current decision and SDK compatibility boundaries

Hive now uses Vercel's Harness interface with Codex and Claude Code adapters.
On September 10, Spencer chose to keep the official Vercel harness rather than
maintain a separate runtime/bootstrap upgrade just to expose newer model controls.
The benefit is shared lifecycle and integration infrastructure; the tradeoff is
that native runtime releases can expose features before the installed adapter
supports them.

These are **version-specific compatibility limits, not confirmed SDK bugs**.
Package observations below describe this checkout, not the newest published
release, production deployment, or every model/account's capabilities.

| Boundary                    | Verified local evidence                                                                                                                                                                              | Product impact                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex Ultra effort          | `@ai-sdk/harness-codex` **1.0.100** declares `reasoningEffort` as `low`, `medium`, `high`, `xhigh`, `max` in `dist/index.d.ts`; its `dist/index.js` bridge parameter schema accepts the same values. | Hive does not expose or accept `ultra`. This is not just a missing slider label.                                                                                       |
| Claude runtime version      | `@ai-sdk/harness-claude-code` **1.0.102** ships a `dist/bridge/package.json` and lockfile pinning Claude Agent SDK **0.3.245** and Claude Code **2.1.245**.                                          | Updating a model label or the host CLI does not upgrade the Sandbox runtime. Hive currently exposes Fable 5, not Fable 5.1; Fable 5.1 is not validated on this bundle. |
| Model-specific capabilities | [The bounded catalog](../src/lib/coding-models.ts) is maintained by Hive, not fetched from the current account's native runtime.                                                                     | An adapter accepting an effort value does not prove every model or account supports it. Keep each model's menu separate from the transport vocabulary.                 |

OpenAI documents `ultra` for supported Codex models in its
[reasoning-effort guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning).
That establishes the native feature's existence, not compatibility with Hive's
installed Vercel adapter. No live Ultra request was made to establish a runtime
failure; the observed blocker is the installed adapter contract and validation.

**Current handling:** retain the official adapter/bootstrap, cap the picker at
the supported per-model options, and preserve the existing defaults. Do not
force unsupported values through type casts, silently relabel Max as Ultra,
or claim that every menu item has been accepted by a live account.

The existing Codex public-text event mapping is a separate integration decision,
not a native CLI upgrade; its evidence and scope remain in
[the streaming diagnosis](STREAMING_DIAGNOSIS.md).

### Revisit on an official adapter or bundled runtime upgrade

1. Inspect the resolved adapter version, exported types, bridge parameter schema,
   and bundled SDK/CLI lockfile together. A newer package number alone is not
   acceptance evidence.
2. Confirm the exact model and effort against the actual runtime/connection.
   Enable Ultra only for models that expose it; do not add it to every engine.
3. Update the shared effort validator, per-model catalog, runner/bridge handling,
   and UI together. Audit the existing Gateway fallback's effort conversion;
   its current `xhigh`/`max` handling does not cover `ultra`.
4. Run catalog, route/reducer, picker, and runner regressions. Preserve defaults,
   explicit selections, queued-work locks, and native history across resume.
5. With separate authorization for live usage, verify both a new turn and a
   resumed turn, including request parameters and an inspectable result. Record
   local checks separately from live acceptance and deployment.

Recheck or retire this dated limitation when those gates pass. Documentation
alone does not authorize a dependency upgrade, paid run, deployment, or upstream
bug report.

## Historical migration proposal — September 2, 2026

The remaining sections describe the pre-migration implementation and original
recommendation, including the then-Codex-only demo scope. They are not a statement
of the current runtime selection or outstanding migration work.

## Short answer

There is no fundamental reason Hive cannot use Vercel's AI SDK Harness. The
current implementation uses the lower-level `ToolLoopAgent` plus four custom
tools and a manually managed Vercel Sandbox. That was the smallest transparent
way to prove the multiplayer product loop, but Hive has now crossed the point
where a real coding harness is the better execution layer.

**Recommendation:** keep Hive's multiplayer task session, authorship, annotations,
steering queue, and safe-boundary state machine; replace only the coding
execution layer with `HarnessAgent` backed by a Vercel Sandbox.

```text
task session + DB -> steering/safe boundary -> HarnessAgent session -> Sandbox
```

The harness is not the multiplayer product. It is the runtime that executes a
team-approved coding turn.

## Does it fit a shared multiplayer task session?

Yes, with one important boundary: a harness session is stateful, but it is not
itself multi-user. Hive should map each shared task session to one stable harness
session and serialize workspace-mutating turns through the existing steering
state machine. Every fresh turn should include the authenticated author as
turn metadata/context; HarnessAgent will not infer authorship from `sessionId`.

For more than one task, use one unique `sessionId` and one persisted resume
record per task session. A stable `sessionId` alone does **not** restore native history:
Hive must also persist the opaque state returned by `session.detach()` or
`session.stop()` and pass it back as `resumeFrom`. This distinction matters on
stateless Next.js/Vercel requests.

## What “Vercel Harness” means

AI SDK 7's `HarnessAgent` is a common interface over established coding-agent
runtimes such as Claude Code, Codex, OpenCode, and Pi. Unlike a model-level tool
loop, the runtime owns built-in coding tools, native conversation state,
compaction, permission flows, skills, and runtime-specific configuration. Its
output still uses AI SDK-compatible `generate()` and `stream()` result shapes.

Official sources:

- [AI SDK Harness overview](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview)
- [HarnessAgent documentation](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)
- [AI SDK 7 announcement](https://vercel.com/changelog/ai-sdk-7)
- [Vercel's HarnessAgent announcement](https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk)
- [Official `vercel/ai` harness source](https://github.com/vercel/ai/tree/main/packages/harness)

## Hive before migration vs. HarnessAgent

| Concern          | Current Hive                                                 | HarnessAgent                                                                    |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Agent runtime    | `ToolLoopAgent` with a 14-step loop                          | Native Claude Code, Codex, etc. behind one interface                            |
| Workspace        | `Sandbox.getOrCreate()` managed by Hive                      | Sandbox lifecycle managed by the harness provider                               |
| Tools            | Four hand-written tools: list, read, write, shell            | Runtime built-ins plus optional AI SDK and MCP tools                            |
| Conversation     | Last 12 task-session messages rebuilt into every prompt      | Native multi-turn session with resume state                                     |
| Context pressure | No compaction beyond truncating tool output                  | Runtime-native compaction and session history                                   |
| Permissions      | Mostly prompt-enforced; sandbox limits host impact           | Runtime permission modes and pausable approvals where the adapter supports them |
| Model choice     | Any Gateway model, including the current free Poolside model | Model choices supported by the selected native runtime                          |
| Product state    | Authorship, annotations, queue, and shared artifacts         | Still Hive's responsibility                                                     |

The largest current weakness is not the number of tools. It is that each run is
effectively a new agent invocation: Hive manually serializes a short transcript
and relies on the model prompt to obey shell restrictions. `HarnessAgent`
directly addresses native session continuity, compaction, built-in tools, and
approval continuation.

## Why the lower-level implementation was reasonable

- It proved the differentiating product idea first: multiple humans share one
  task session, annotate intent, and steer work at explicit boundaries.
- Four visible tools keep the execution boundary small and auditable.
- It can use an inexpensive arbitrary AI Gateway model.
- Hive keeps complete control over artifact collection and the exact repository
  working directory.

Those are scope advantages, not evidence that the custom loop is a better
long-term coding runtime.

## Tradeoffs of switching now

- Harness packages are still marked experimental and may introduce breaking
  changes.
- Bridge-backed adapters add startup/bootstrap complexity and require a network
  sandbox with an exposed port.
- Native runtime model choices may cost more than Hive's current free Poolside
  model.
- Adapter capabilities differ. In particular, the official Codex adapter does
  not currently support built-in tool approval or built-in tool filtering;
  Claude Code supports both. See the [official adapter capability table](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)
  and [Codex adapter limitations](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex).
- Current harness packages require Node.js 22 or newer; see the
  [`@ai-sdk/harness` package manifest](https://github.com/vercel/ai/blob/main/packages/harness/package.json).

## Selected adapter for the demo

Use Codex only. Hive is the product; Codex is its execution engine, so exposing
a runtime selector would add configuration without improving the multiplayer
interaction being tested. The Codex adapter supplies native repository tools,
conversation continuity, and automatic context compaction. During development,
route its requests through AI Gateway to the lower-cost
`openai/gpt-5.1-codex-mini` model.

The Codex adapter does not currently expose native tool approval or built-in
tool filtering. Hive therefore owns the meaningful human control points:
attributed steering is serialized before a turn mutates the workspace, and the
shared diff is explicitly approved after the turn. This is a deliberate product
boundary rather than a hidden adapter capability.

## Tight migration boundary

1. Add `@ai-sdk/harness`, one harness adapter, and `@ai-sdk/sandbox-vercel`.
2. Map one Hive task session/repository to a stable harness `sessionId`.
3. Persist the opaque `resumeFrom` state alongside the task session when detaching or
   stopping a session.
4. Seed or clone the GitHub App repository in `sandboxConfig.onSession` (or pass
   a caller-owned prepared sandbox session).
5. Send the selected task plus author identity as the fresh turn; keep the full
   human transcript in Hive rather than replaying it as model history.
6. Project harness stream events into Hive activity, terminal, diff, and
   approval UI.
7. Keep the existing steering queue as the concurrency policy; only one
   approved turn mutates the shared workspace at a time.

This is a focused replacement of `runHiveCodingTask`, not a rewrite of the
full-stack product.

### Repository path routing

`sandboxConfig.workDir` is relative to the sandbox's default working directory;
without it, HarnessAgent chooses a session-specific directory based on the
harness and session IDs. Hive should therefore choose one canonical repository
working directory per task session and clone into the exact `sessionWorkDir` supplied
to `sandboxConfig.onSession`. The alternative is to keep the existing private
GitHub-App clone flow, wrap that native Vercel Sandbox with
`createVercelSandbox({ sandbox })`, and pass its restricted session to
`agent.createSession()`. Either approach avoids the current path assumption
leaking into adapter code.

## Architectural boundary

The existing harness supplies execution; Hive supplies shared task state, attributed intent, steering and review. Keeping these responsibilities separate avoids rebuilding commodity runtime infrastructure while preserving the multiplayer behavior that the product owns.

This note includes historical decisions. Use the compatibility record above for the current adapter boundary rather than treating an earlier migration proposal as unfinished implementation.
