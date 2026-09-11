# Hive — Product walkthrough

Use a small repository change to explore how teammates share one coding agent. The [public UI demo](https://hive-roan-mu.vercel.app/demo) uses page-local sample data and does not run an agent. Use the [live application](https://hive-roan-mu.vercel.app/) for real collaboration.

## Before starting

- Sign in with two GitHub accounts in separate browsers. Create a task and use its Invite link to admit the other account.
- Attach a repository authorized for the current account. An invitation does not grant access to the inviter's other repositories or tasks.
- Confirm both identity menus and live connection status. Read the task's actual runtime/model selection.
- Choose a bounded change, such as adding an accessible name to an existing button while preserving a caller override. Use a disposable task for new execution; preserve any result you still need to inspect.

## Shared task flow

1. Discuss the behavior in a Thread with a reply from each teammate. Replies remain human discussion until someone explicitly steers them.
2. Ask Hive to implement the bounded change and run the repository's relevant checks. While it is active, queue a Thread once. Both browsers should show the same frozen reply boundary, authors and promoter.
3. Add a later discussion reply and verify that it does not silently enter the already queued instruction. Apply remains unavailable while the current run is active.
4. Inspect the actual Diff, unchanged as well as changed Files, and expanded command output in Runs. An exit code is process evidence, not an inferred test verdict.
5. At the safe boundary, apply the queued input and inspect the attributed result. If execution finished before queuing, this is an immediate-steer case; do not rerun just to manufacture a queue window.
6. Refresh the second browser and verify that discussion and workspace state persist. A finished run or approved diff leaves the conversation open.

## Recovery and evidence

Runs shows the latest turn, not a command-history browser. A later reply-only turn can correctly show **No commands in this turn**. Inspect useful command output before starting another turn; do not reset or restore merely to recreate an old view.

Checkpoints pair files with native agent context. Unmatched snapshots cannot be restored. Restoring is a separate, explicit operation that preserves team discussion and pending steers and invalidates approval.

If a request fails or is rate-limited, retain the real failure and pending queue. Avoid repeated retries or presenting saved output as a new pass. A run that has not reported for six minutes can be marked lost without erasing the discussion; Reset instead clears it and requires confirmation and an idle task.

## Code boundaries

- [Task state machine](../src/lib/task-session.ts): discussion versus execution, frozen Thread input and safe-boundary application.
- [Task store](../src/lib/task-session-store.ts): row-locked transitions and one execution grant when teammates act concurrently.
- [Prompt construction](../src/lib/hive-prompt.ts): separate authors, promoter and execution starter.
- [Runner](../src/lib/hive-runner.ts) and [restore path](../src/lib/workspace-restore.ts): execution and paired recovery.

See [release status](ROADMAP.md), the [development log](DEVELOPMENT.md#evidence-log) and [SDK compatibility limits](VERCEL_HARNESS_DECISION.md#current-decision-and-sdk-compatibility-boundaries). Controlled tests, read-only UI checks and successful live execution should always be described separately.
