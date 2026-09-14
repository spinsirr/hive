# Production acceptance

Use this checklist against one identified production commit and deployment. It describes work to execute, not recorded passes. Local tests, a successful deployment and a final screenshot cannot establish a working live journey.

## Run setup

Record the commit/deployment, origin, browser/viewport, input method, runtime/model/effort, two authorized accounts and isolated QA task URLs. Do not include invitation tokens or credentials. Use a new account when testing first signup; two browser profiles of the same person are not two-account acceptance.

Run `pnpm test:release` with disposable Postgres and link the matching CI result. Start each production case as NOT_RUN and record purpose, input/action, expected and observed behavior, evidence and PASS/FAIL/BLOCKED/NOT_APPLICABLE. Missing credentials/accounts are a limitation, not a pass.

Keep code changes inside disposable QA Sandbox working copies. Preserve existing tasks, credentials, billing and unrelated data. Do not destroy production workers or Sandboxes to manufacture a recovery failure. Stop a quota/auth failure, record its redacted identifier and continue independent cases.

## Continuous core journey

Repeat the journey on a fresh desktop task, a warm task with a teammate, and a narrow 390px viewport. Exercise keyboard input, mouse/touch, reduced motion and long content. A resized desktop browser is not proof of real mobile keyboard behavior.

| Journey            | Required observations                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter and invite   | Fresh login reaches a usable empty dashboard. Start without a repository/title ceremony, invite B, reload both accounts and retain the same task. Membership and repository access remain distinct.                                                                           |
| Talk to Hive       | One attributed prompt produces incremental text in the correct conversation. Preserve model/effort, native context and meaningful waiting/error feedback across a second turn.                                                                                                |
| Attach and execute | Attach an authorized QA repository, make a small real change, inspect the file/diff and original command output. Resume without a fresh clone or unnecessary GitHub token request.                                                                                            |
| Edit and queue     | Edit one's own message; keep drafts, history and discussion. Queue input while running, edit/remove/reorder it, then observe one automatic continuation of the exact eligible head across two viewers. Failed or restored work stays paused.                                  |
| Discuss in Thread  | Ordinary replies and teammate mentions do not run the agent. Explicit steering freezes the selected discussion; later replies remain excluded. Keep author, promoter and execution starter distinct.                                                                          |
| Answer a question  | Ask one designated teammate once. One inline card accepts one answer and continues once. A busy answer queues; closing all viewers preserves it until reconnect. Thread-origin questions and responses remain in their Thread.                                                |
| Inspect and review | Read actual Files/Diff/Runs, select code lines, discuss and steer feedback. Review → changes → back returns to the same Thread. Only explicit eligible human verification resolves the current completed revision; a new run/restore invalidates an old verification.         |
| Restore            | Cancel once, then restore a recorded checkpoint. Files and native context restore together; discussion/queue survive, review is invalidated and no run starts. Concurrent confirmations produce one restore. Confirmation settles the dialog/banner and unlocks the composer. |
| Reconnect          | Disconnect a browser during sending or deltas. Preserve an unconfirmed draft, retry with the same identity and reconcile once. Delayed snapshots cannot roll back new text, queue or workspace state.                                                                         |
| Archive and return | Busy archive is blocked. Idle archive is shared and read-only after reload, including stale open controls. Restoring the archive retains data and enables normal controls without starting the agent.                                                                         |

Use natural requests for experience testing. Keep machine markers in explicitly identified protocol tests, not every visible agent response. Requesting a question/review should show its card without duplicate acknowledgements or extra Threads.

## Experience checks

- Record input, local acknowledgement, server acceptance, first visible text, at least two partial bodies, final text and settled controls. Observe both viewers; report a latency interval if sampling missed first text.
- Local acknowledgement targets 100 ms; over 300 ms fails immediate feedback. Waiting remains visible at the actual reply destination. Confirmed controls should settle within one second. These are acceptance targets, not provider guarantees.
- Follow new text only while the reader is at the bottom. Reading older messages must not be interrupted by streaming, typing, menus or replies. Saved tasks open at the latest content without animating through history.
- Opening/closing Thread, review, menus and dialogs preserves the correct draft, selected pane and focus. No focus on detached controls, unexpected navigation or layout jump.
- Verify Chinese IME, Shift+Enter, empty input, retry and read-only states. Inspect narrow layouts and actual mobile keyboard/safe-area behavior when available.
- Reduced motion remains usable. Screen-reader and frame-continuity checks require actual observations; DOM semantics and screenshots alone do not prove those behaviors.
- Demo uses the same components with clearly simulated data. It is not live acceptance evidence.

## Separate capability checks

| Capability             | Required evidence                                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization          | Anonymous and authenticated nonmember reads/writes fail; forged/expired invitations fail. A task invitation does not grant the inviter's other repositories. Run controlled adversarial probes separately from the core UX journey.                                                 |
| Repository memory      | Explicitly save one harmless unique human contribution. A new task on the same repository recalls it with correct attribution; a distinct repository does not. Pending writes and missing second-repository coverage are not passes. Record test-memory IDs for authorized cleanup. |
| Native children        | Observe real research/review child startup, inherited task/model/permissions, output and persistence. Stop one child from the other account; confirm stopping or show Unconfirmed. Parent and queue remain intact. Do not infer success from a placeholder row.                     |
| Runtime/model controls | Exercise each advertised runtime and supported setting being released. A successful Codex turn does not qualify Claude or every model/effort. Native history and authentication boundaries must remain intact.                                                                      |
| Subscriptions          | For each supported provider, run planning, repository coding, a warm second turn and checkpoint resume in isolated QA tasks. Confirm the expected account/authentication source and retained native context.                                                                        |
| Recovery failures      | Test interrupted restore/worker loss only in an authorized controlled environment. Browser disconnect, hard worker loss and deleted Sandbox recovery are different cases; do not infer one from another.                                                                            |

Verify expired subscription credentials and exhausted quota with controlled fixtures; never deliberately consume a real quota. These failures must not start an API/Gateway turn. Record real-account results separately from fixture results, without including tokens.

## Result

Record failures with reproduction steps, corrected revision and the affected journey's recheck. Do not combine observations from different revisions into an unlabeled pass. Distinguish core-flow acceptance from all optional capabilities; keep untested real mobile, screen-reader, model, memory and child cases explicit.

Keep detailed run evidence private or attached to the issue/PR. Do not add a dated report for every run to `docs/`. Archive QA tasks only when idle and cleanup is authorized; retain representative evidence and never reset unrelated work to tidy the dashboard.
