# Bounded Codex delegation

Spencer requested research/review subagents and Codex Desktop-like controls after the earlier submission scope freeze. This slice adds delegation to the existing harness; it does not replace Hive's execution architecture or turn Hive into a full desktop IDE.

## Product boundary

- The team still talks to one Hive agent. Teammate messages queue as before; discussion threads require explicit steering.
- Hive can delegate **repository research** or **code review**, at most **two child tasks total per parent turn**. Children are instructed to inspect and report, leaving code changes and further delegation to the parent.
- Per Spencer's follow-up, children reuse the current task's model, reasoning effort, permissions, MCP configuration, skills and developer instructions. Hive no longer enumerates and disables inherited servers or adds a separate child permission policy. Native review explicitly keeps the selected task model; the current task's configured effort remains low.
- Research/review is an assigned role, not a separate read-only security tier. Permission enforcement follows the parent's sandbox policy in the same task VM. The child starts a new conversation with the delegated request and inherited instructions; it can read attributed team context through `get_context`, not an automatic fork of the full conversation history.
- Results belong to the parent's message, not to a fake new teammate. Expand a row to see its assignment and result. A task member may stop a live child without interrupting the parent or reordering the queue.
- A child lasting 120 seconds receives an interrupt request. Parent shutdown also interrupts unfinished children, waits for confirmation, and then shuts down its owned native process. **Stopping is not stopped**; missing confirmation remains **Unconfirmed**.
- Child native threads are ephemeral. Bounded results and status are persisted in the shared conversation; this slice does not offer resuming, forking, steering, or directly chatting with a finished child.

## Actual APIs, not simulated execution

| Hive operation | Public Codex App Server API |
| --- | --- |
| New research/review context | `thread/start` with the current task's settings |
| Repository research | `turn/start` |
| Code review | `review/start` on that new thread |
| Stop one child | `turn/interrupt` with the recorded thread + turn IDs |
| Status / result | Native item and turn notifications; `exitedReviewMode` for review |

Sources: [App Server overview](https://learn.chatgpt.com/docs/app-server#api-overview), [native review](https://learn.chatgpt.com/docs/app-server#review), [configuration inheritance](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents). Implementation is checked against the generated protocol and executable from the project's pinned **Codex 0.149.1**, not an assumed current desktop interface. No CLI, model or dependency upgrade was necessary.

Hive's existing task-scoped MCP exposes `spawn_subagent`, `read_subagent`, and `stop_subagent`. The authenticated host forwards only these bounded operations through a private Unix socket in the **existing** Vercel VM. A per-task/per-run derived capability protects this channel; there is no additional public port or arbitrary-RPC endpoint. Children inherit the same short-lived, task-scoped runtime capabilities; existing membership/run checks still apply. The shared signing secret, database credentials and Mem0 key stay on the host. Runtime configuration and credentials are not included in shared progress or results.

Progress uses the existing reply WebSocket. Text and subagent updates have independent monotonically increasing sequences, and independent atomic JSON patches preserve both. Run-ID fencing rejects old callbacks after recovery or a new turn. Control reads select only workspace identity and run metadata, never the full transcript, files, or native checkpoint. There is no new idle heartbeat or background polling loop.

## Verification and limits

- Default suite: controller concurrency/caps/idempotency, native-review nested-turn regression, cancellation acknowledgement vs completion, provisioning-stop race, parent drain, failed start, real MCP client, authenticated stop route, real React controls, and WebSocket ordering.
- `scripts/diagnostics/check-codex-subagent-process.mjs`: **actual pinned CLI**, private capability IPC, parallel research + native review, an actual inherited authenticated `get_context` call, inherited MCP discovery, unchanged model/effort and real interruption. A read-only parent fixture verifies that its children also deny filesystem writes; controller tests additionally verify that a child's policy is not substituted when its parent is writable. Uses isolated Codex home and loopback Responses/MCP services: no personal Codex account or paid model calls.
- `scripts/check-stalled-run.mjs`: actual disposable local Postgres verifies concurrent text/child patches, privacy of control projections, and old-child callback fencing after recovery/new runs. Deletes only its generated fixture database afterward.
- `/demo/subagents` is explicitly labeled sample UI, not a live run. It reuses the production disclosure/result component.

**Not yet deployment evidence:** these changes have not been pushed or deployed in this implementation round. The native OS-sandbox check was local macOS, not a new Vercel Linux smoke test. A deployed two-viewer delegation/Stop/result persistence check remains required before presenting this as a verified production capability. The existing request-duration and hard-worker-loss limitations still apply; this is not durable Workflow orchestration or a guarantee against provider rate limits.
