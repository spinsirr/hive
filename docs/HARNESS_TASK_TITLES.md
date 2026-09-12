# Task titles and Harness metadata

Checked 2026-09-12 against this checkout, installed package source, and official
documentation. The investigation below records the previous naming flow and the
SDK boundary. The subsequent Hive implementation is described next; this is not
a claim of production deployment or live-model title generation.

## Implemented in Hive

New task now opens an unnamed conversation immediately. `task-title.ts` defines
the display label and bounded first-message excerpt; the shared reducer assigns
that excerpt in the same transaction as the first accepted message. An empty
stored title means not yet named, while any nonempty name is preserved until a
member explicitly renames it. This requires no schema migration or extra run.
The shared header reads the current session snapshot and exposes `TaskTitleControl`.
Renaming preserves the stable task ID/URL and uses the existing authenticated task
action path, membership checks, live updates and archived read-only boundary.
Demo reuses that control and reducer. Unit, component and real local Postgres
checks cover first-message naming, concurrent writes, manual names, run completion,
invalid names, cross-task access and immutable task identity.

## Conclusion

Requiring a task name before entering Hive is **our product choice, not a
Harness requirement**. We can remove that interruption without replacing the
execution harness. However, the installed unified Harness interface does not
offer a portable auto-generated task-title API. Native Claude metadata can be
read with additional adapter integration; Codex exposes a thread name, but the
documented name API is not a guaranteed automatic title generator.

## Why Hive previously asked first

- The shared dashboard's new-task form requires `title`, limited to 120
  characters: [`task-dashboard.tsx`](../src/components/hive/task-dashboard.tsx),
  lines 14–55. The server action rejects an empty value before creating the task:
  [`actions.ts`](../src/app/actions.ts), lines 9–22.
- The store independently rejects an empty title, derives an initial URL slug
  from it, and writes the task and creator membership in one transaction:
  [`task-session-store.ts`](../src/lib/task-session-store.ts), lines 164–198.
  No agent runs during this operation. The underlying state initializer already
  supports `Untitled task`: [`task-session.ts`](../src/lib/task-session.ts),
  lines 310–341.
- A coding Harness session is created later, when a repository-backed turn runs:
  [`hive-runner.ts`](../src/lib/hive-runner.ts), lines 290–295 and 447–463.
  Pre-repository planning also creates its own native session only when replying,
  and stops the planning sandbox afterward:
  [`hive-planning-harness.ts`](../src/lib/hive-planning-harness.ts), lines 30–58.

Therefore there is no existing native session whose title the new-task dialog
can fetch. A task's identity and URL must remain stable when its display title
changes; renaming must not create a new task or native conversation.

## What is actually exposed

| Layer | Verified capability | Boundary |
| --- | --- | --- |
| `@ai-sdk/harness` 1.0.98 | `createSession`, stable `sessionId`, lifecycle/resume state, text/tool/compaction events and adapter-specific metadata/raw events. | No common session `title`, `getTitle`, or title-change event. The `summary` on a compaction event summarizes context, not a sidebar task name. |
| `@ai-sdk/harness-codex` 1.0.100 | Official bridge forwards the native thread ID for resume. | Its session/event mapping does not expose a title. Hive's custom app-server turn driver also captures only `thread.id` at startup and does not consume `thread/name/updated`. |
| `@ai-sdk/harness-claude-code` 1.0.102 | Bundles Claude Agent SDK 0.3.245 / Claude Code 2.1.245. Native SDK has `getSessionInfo` / `listSessions` and `SDKSessionInfo.summary`. | The installed Harness bridge does not call those functions or forward a session title; its final Claude metadata includes session ID and cost. |

Evidence: installed `node_modules/@ai-sdk/harness/src/v1/harness-v1-session.ts`
lines 23–86 and 155 onward; `harness-v1-stream-part.ts` lines 29–137;
`harness-codex/src/bridge/create-emit-stream-event.ts` lines 77–85;
`harness-claude-code/src/bridge/package.json` lines 6–8 and
`src/bridge/index.ts` lines 498–506 and 601–620; Hive's
[`app-server.mjs`](../src/lib/codex-bridge/app-server.mjs), lines 270–309.

The [official HarnessAgent documentation](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)
describes session identity and opaque resumption, not title generation. The
public [session contract](https://github.com/vercel/ai/blob/6c6c2210b9532a4c369615c044a16d595f3db117/packages/harness/src/v1/harness-v1-session.ts)
and [stream contract](https://github.com/vercel/ai/blob/6c6c2210b9532a4c369615c044a16d595f3db117/packages/harness/src/v1/harness-v1-stream-part.ts)
at the inspected upstream revision likewise have no portable title field.

### Native Claude versus Codex

Claude's `SDKSessionInfo.summary` is a display label: a custom title, generated
summary, or first prompt. It is **not guaranteed to be a generated short title**.
`getSessionInfo` can return no session. The pinned 0.3.245 `sdk.d.ts` also
documents that supplying `Options.title` replaces automatic naming from the
first user message; setting a title is distinct from reading a generated one.
See the [official TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript#getsessioninfo)
and the verified [pinned SDK package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.245).
Reading this metadata would need to happen in the existing sandbox/runtime,
not by scanning another user's host sessions.

Codex's documented `thread/name/set` explicitly assigns a name and emits
`thread/name/updated`. Read/resume/list responses can include `thread.name`;
start/fork responses may have no name until one is set. These APIs establish
read/write support, **not that Hive can request a fresh empty thread and receive
an automatically generated title**. See the [official app-server reference](https://learn.chatgpt.com/docs/app-server).

## Recommended product behavior

1. Let **New task** open an empty task immediately. Keep the normal authenticated
   creation and membership transaction, using a stable generated task ID and a
   neutral initial label.
2. Derive the first useful label from the first actual human task message, once,
   in Hive's atomic state update. This works before repository attachment, with
   either engine, and when inference fails. Do not derive it from the wrapped
   native prompt, which contains Hive context and instructions.
3. Treat richer native titles as an optional later enhancement, not a creation
   dependency. Keep Hive's persisted display title authoritative across engine
   changes and restores; never overwrite a deliberate human rename. A generated
   title should not post a conversation message or wake the coding agent.

This recommendation removes the manual-name requirement with no new model call,
SDK fork, title polling, or extra sandbox just to name a task. If genuine
model-generated names are required, define that separately and test the native
metadata path for each adapter; do not label a truncated first prompt as an
AI-generated summary.
