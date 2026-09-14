# Development and architecture

Hive owns collaboration state; the installed coding harness owns tools and native agent history. One task has one conversation, at most one repository and one workspace-mutating run at a time.

## Module boundaries

| Directory                                                  | Ownership                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/`                                                 | Next pages, routes and server actions; compose the layers below.                                                                     |
| `src/components/hive/`                                     | Shared workspace shell and scoped client; `conversation/`, `workspace/` and `tasks/` own their feature UI.                           |
| `src/hooks/`                                               | Client synchronization, drafts, navigation and recovery behavior.                                                                    |
| `src/lib/session/`                                         | State, action validation, reducer transitions and public snapshot contracts.                                                         |
| `src/lib/tasks/`, `conversation/`, `workspace/`, `agents/` | Shared domain rules, selectors and validation; no server or UI dependencies.                                                         |
| `src/lib/demo/`                                            | Local sample data and simulation using the same domain rules.                                                                        |
| `src/server/sessions/`, `auth/`, `workspace/`              | Transactions/live relay, identity/repository authorization and sandbox lifecycle/artifacts.                                          |
| `src/server/agents/`                                       | Execution, prompts and streams; `codex/` and `claude/` own provider adapters/auth, `tools/` owns MCP, `memory/` owns recall/storage. |
| `src/server/agents/codex/bridge/`                          | Portable native Codex connection, turn collection, transport and children, copied together into the sandbox.                         |
| `src/db/`                                                  | Database connection and schema; migrations stay in `drizzle/`.                                                                       |
| `tests/`                                                   | `ui/`, `agents/`, `integration/`, `native/` checks and shared `helpers/`; unit tests remain beside source.                           |
| `scripts/`                                                 | Build preparation, release coordination and operator enrollment.                                                                     |

Imports point from routes/UI to shared domain code or server services. Shared code and components cannot import `src/server` or `src/db`, including type imports; shared contracts live in `src/lib/session`. Server/domain code cannot import routes, components or hooks. ESLint enforces these directions and rejects runtime import cycles. Production components also cannot depend on demo code.

Within `src/lib/session`, `task-session-actions.ts` validates client actions, `task-session.ts` dispatches reducer transitions, and `task-session-commands.ts` owns frozen input admission and execution start. Public snapshot contracts and projections stay alongside the state model. `src/lib/utils.ts` contains the shared class-name helper; do not use it as a miscellaneous domain bucket.

## Input and execution

Normal messages address Hive. Leading teammate mentions and ordinary Thread replies remain discussion. Explicit steering freezes the selected body, author, source and reply destination; later discussion cannot rewrite accepted input.

The store grants execution while holding task and membership row locks. Other submitted instructions queue in order. After a successful run, connected clients can request continuation of the exact queue head; the transaction grants it once. Errors and restored history pause automatic continuation. Closing every viewer delays continuation until reconnect.

Editing requires authorship and the expected revision. A queued edit must still refer to the same unapplied instruction. Structured answers are recorded once for the designated member. Human review verification names the completed workspace revision; a later run or restore invalidates stale verification. Finishing a turn does not close the conversation.

Provider calls run outside task/member row locks. Checkpoint imports and environment updates compare the state they observed before writing, so delayed results cannot overwrite a newer run or restore. Renewals serialize per VM.

Execution remains request-bound. A committed execution grant is not a durable job dispatch; a hard worker loss can strand a run. Manual lost-run recovery preserves discussion and queued input. Workflow integration is not implemented.

## Public data and recovery

Postgres stores the team history and private recovery state. Public SQL and in-memory projections share field allowlists. Native resume data, checkpoint payloads and restore VM identities stay server-side; public command evidence retains nullable exit codes.

A checkpoint pairs files with native context. Restore preserves discussion and the queue, invalidates review and starts no agent turn. Late callbacks are fenced by run/restore identity. Files is a read-only inspection surface; the sandbox reader rejects unsafe paths and symlinks. Its asset and the native bridge files must remain in Next's output tracing.

## Live collaboration and tools

Authenticated WebSockets own presence. Postgres `LISTEN/NOTIFY` relays snapshots, reply changes and ephemeral member/typing announcements across instances. Presence counts people, not tabs; observers do not count as participants. It is a bounded observation, not proof that someone is actively looking at the page.

Task-scoped MCP tools recheck membership and the active run. `get_context` returns bounded attributed context, `get_presence` observes online members, and `read_thread` reads a discussion while withholding pending instructions. These reads do not authorize execution. Replies, structured questions and review requests retain their source authors and destinations.

Optional repository memory shares the installation/repository scope for automatic recall and explicit tools. Recall is bounded untrusted context. Writes select an existing human contribution and require an explicit request; a pending provider result is not a confirmed save. See [setup](SETUP.md) for configuration.

Codex research/review children use the parent's task, model, settings and permissions in the same VM. They have separate native threads and bounded results attached to the parent message. Stop affects the selected child; an interrupt request is not confirmation that it stopped. Child lifecycle is not durable background orchestration.

## Runtime changes

Use the adapter versions pinned in `package.json` and the lockfile. Model/effort labels in `coding-models.ts` must match the installed adapter schema and bundled CLI; changing labels or the host CLI does not upgrade a Sandbox runtime. Native history stays bound to its harness and authentication boundary.

When upgrading an adapter, check its types and bundled runtime, run the [native protocol checks](TESTING.md#native-runtime-checks), verify output tracing, and repeat the relevant [production journeys](RELEASE_ACCEPTANCE.md). Code-quality conventions live in [CODE_QUALITY.md](CODE_QUALITY.md); historical investigations and review reports remain in Git history.
