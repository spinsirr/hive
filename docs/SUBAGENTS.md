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

### September 10 Pacific: live owner Stop acceptance

The supervising assistant sent **one** bounded request as Spinsirr in the [independent delegation task](https://hive-roan-mu.vercel.app/sessions/verify-live-subagent-collaborati-ugic3a), timestamped **September 11, 02:34:02 UTC**. Its current settings were Codex / GPT-5.6 Luna / Low. It requested exactly two read-only children: Research would call inherited context, then run one `sleep 45` to provide a Stop window; Review would inspect the existing task/run control boundaries. No new repository, invitation, credential, model choice, reset or restore was introduced.

Observed directly on the live page:

- Research reached **Working** with an enabled **Stop research subagent** control. Review also appeared and was already **Completed** before the Stop click.
- One click on Research's Stop first disabled its button and displayed **Stopping** while the child status still read Working. A subsequent live update changed the actual child status to **Stopped** and removed the control. The button's pending text alone was not treated as confirmation.
- The parent continued streaming a final response distinguishing Research **Stopped** from Review **Completed**, then returned to its ordinary idle composer. No replacement child appeared. Research's partial disclosure retained its context/stop-window report; Review retained its separate result.
- A page refresh retained exactly those two current-turn child records, their statuses and the parent's final answer. Diff remained empty, and the latest parent Runs view showed no commands. The prepared accessibility-demo task was not changed.

**Scope:** one successful owner-operated production Stop and parent completion, not a two-account Stop test. Review had finished before cancellation, so this does not test interrupting one child while another remains actively running. The child reported its context lookup and sleep, but the current UI does not expose the underlying child tool trace; do not promote those reports to independently observed tool-call evidence. Joseph has not been invited to this task: permission to do that was requested separately and is still required before extending access. No automatic retry or second model turn was sent.

### September 10 Pacific: persisted production result recheck

On **September 11, 02:26–02:28 UTC**, a fresh owner-authenticated page in the [real delegation task](https://hive-roan-mu.vercel.app/sessions/verify-live-subagent-collaborati-ugic3a) showed later evidence than the original failed attempt below. The turn timestamp was **September 10, 20:27:21 UTC**. Two production child rows, **Research** and **Code review**, each displayed **Completed**, with expandable assignments and separate results. Refresh retained both statuses and both complete result disclosures; this was not `/demo/subagents` or a new model run.

Research's saved result named the actual task, `spinsirr/hive`, Spinsirr, the `hive` package and an abbreviated test script. Review's saved result said no issues found and cited the task/run checks in `subagents/route.ts` and `subagent-control.ts`. The parent summary referenced both results. The task currently displayed GPT-5.6 Luna / Low, no git diff and no commands in its latest-turn Runs view. Current selector state is not independent proof of the earlier execution configuration.

**Proven by this recheck:** persisted completed child records, distinct result disclosure and refresh recovery in the real task. **Still not proven by this recheck:** live startup/parallel timing, the child's actual inherited `get_context` invocation (the text reports it, but the UI does not expose its tool trace), cross-account live Stop/acknowledgement and stopping one child while preserving its parent. A review's “no issues found” is the agent's conclusion, not a security audit verdict. The earlier 429 attempt remains valid historical evidence, but it is no longer the latest persisted outcome.

### September 10 production attempt

The owner explicitly requested deployment and live testing. Commit `e24bbabef410e0a65415814f78f072028d141abe` was pushed to the existing private repository and deployed through its GitHub/Vercel integration. [Deployment `EjVcNfz8URk2YJAGTuBYu7g39E4p`](https://vercel.com/spinsirrs-projects/hive/EjVcNfz8URk2YJAGTuBYu7g39E4p) became Ready after a 48-second production build. `/demo/subagents` returned 200 with its sample-content label; the independent task API returned 401 without authentication.

An [independent task](https://hive-roan-mu.vercel.app/sessions/verify-live-subagent-collaborati-ugic3a) was created and attached to `spinsirr/hive` after the existing GitHub reconnect flow. One prompt requested two bounded research/review children, inherited context and real results, without edits or memory writes. The in-app browser and Chrome both showed the shared request and running state. Both used **Spinsirr**: this is cross-browser observation, not two-account acceptance.

The run began at **2026-09-10 07:06:32 UTC**. Gateway recorded five HTTP 200 responses for `openai/gpt-5.1-codex-mini` between **07:07:16 and 07:08:39**, followed by 429s at **07:09:26, 07:09:44 and 07:10:17**. Its dashboard listed Azure, but did not expose routing details or the limiting quota. Two bounded retries waited **17,975 ms** and **32,698 ms**, then stopped. See the [last Gateway request](https://vercel.com/spinsirrs-projects/~/ai-gateway/logs?selectedLogId=gen_01M252EABQH1AE4Z39PZB9VDAP) and [host log](https://vercel.com/spinsirrs-projects/hive/logs?selectedLogId=666pd-1789023992611-ed390288c73a&panelState=opened).

Runs retained four inspection commands, including a search for `spawn_subagent`; **no child row or successful delegation was observed**. Diff stayed empty. Fresh in-app and reloaded Chrome pages retained the single prompt, quiet error and Pacific message times. No additional user turn was submitted; existing presentation tasks, billing, model selection and repository visibility were unchanged.

**Result: deployed, live subagent acceptance incomplete.** Child startup, inherited tools in a production child, cross-browser Stop and final result persistence remain unverified. The 429 is not a passing test or proof that tool discovery is correct. The native OS-sandbox check remains local macOS evidence, not Vercel Linux evidence. Request-duration and hard-worker-loss limitations still apply; this is not durable Workflow orchestration or a guarantee against provider limits.
