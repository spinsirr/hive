# Vercel Harness decision

Last checked: 2026-09-02

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

| Concern | Current Hive | HarnessAgent |
| --- | --- | --- |
| Agent runtime | `ToolLoopAgent` with a 14-step loop | Native Claude Code, Codex, etc. behind one interface |
| Workspace | `Sandbox.getOrCreate()` managed by Hive | Sandbox lifecycle managed by the harness provider |
| Tools | Four hand-written tools: list, read, write, shell | Runtime built-ins plus optional AI SDK and MCP tools |
| Conversation | Last 12 task-session messages rebuilt into every prompt | Native multi-turn session with resume state |
| Context pressure | No compaction beyond truncating tool output | Runtime-native compaction and session history |
| Permissions | Mostly prompt-enforced; sandbox limits host impact | Runtime permission modes and pausable approvals where the adapter supports them |
| Model choice | Any Gateway model, including the current free Poolside model | Model choices supported by the selected native runtime |
| Product state | Authorship, annotations, queue, and shared artifacts | Still Hive's responsibility |

The largest current weakness is not the number of tools. It is that each run is
effectively a new agent invocation: Hive manually serializes a short transcript
and relies on the model prompt to obey shell restrictions. `HarnessAgent`
directly addresses native session continuity, compaction, built-in tools, and
approval continuation.

## Why the lower-level implementation was reasonable

- It proved the differentiating product idea first: multiple humans share one
  task session, annotate intent, and steer work at explicit boundaries.
- Four visible tools make a six-hour take-home easy to explain and audit.
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

## Presentation framing

> We first built the thinnest execution loop needed to validate multiplayer
> intent and safe steering. Once that interaction model worked, we identified
> the custom coding loop as commodity infrastructure. The next scoped step is
> moving that execution boundary to Vercel Harness while keeping the shared-session
> state machine as our product differentiation.

That tells a stronger judgment story than either “we built everything
ourselves” or “we delegated the whole product to an existing harness.”
