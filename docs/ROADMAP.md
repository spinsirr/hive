# Hive — Scope and release status

Hive supports agentic peer programming around one shared coding task. Teammates can join work in progress, contribute context, answer the agent’s questions and review changes together.

## Current scope

One task has one conversation, at most one attached repository, and one mutating run at a time. Finishing a run or approving a diff does not close the conversation. GitHub identity, task membership and repository access remain separate boundaries.

The current iteration prioritizes core-flow verification and blocking fixes. PR automation, sandbox branch pushes, issue triage, uploads and multi-team administration are outside the product scope.

### Execution architecture

Vercel Workflow integration remains deferred. Postgres owns collaboration state and input ordering; the existing harness owns request-bound execution. Browser reconnection, caught-failure continuation and paired checkpoints do not establish automatic recovery after hard worker termination. See the [Workflow assessment](WORKFLOW_TRADEOFF.md).

### Optional capabilities

- Repository memory stores selected human contributions with authorship and source IDs. A bounded live save/recall round and a later source-citation retest passed; live cross-repository isolation remains unverified. See [memory boundaries](MEMORY_TRADEOFF.md).
- Research/review subagents share the current task's model, tools, skills and permissions. Controlled checks passed, but the recorded live attempt stopped on Gateway 429 before an observed child start. See [subagent evidence](SUBAGENTS.md).
- Message editing and compact queue actions are a separate [PR #5 release candidate](https://github.com/spinsirr/hive/pull/5), not evidence of production two-account editing.

## Peer collaboration update — September 11, 2026

Structured agent questions and review requests are implemented through the existing task queue and Threads. Answers resume the original task; steered review feedback streams back to its source Thread. Human verification is tied to a completed code revision. Busy-answer continuation requires a connected client and does not establish durable background execution.

Controlled UI checks and a real disposable local Postgres/MCP check passed, including concurrent answers, one execution grant, task membership, stale-run rejection and revision-bound review. Model completions in that check were fixtures. Real-model acceptance with two authenticated accounts remains pending. The public demo has four separate sample tasks and simulated output, accessible without login.

## Verification status

The following summarizes dated checks, not a claim that all scenarios passed in one uninterrupted run. See the [development log](DEVELOPMENT.md#evidence-log) and [post-review verification](POST_REVIEW_VERIFICATION.md) for revisions, dates and limitations.

- [x] Execute a small real repository change and inspect its two-file Diff, full Files tree and command output. The September 8 combined check exited 0 with 125 tests on the saved Sandbox revision, plus controlled regressions and TypeScript.
- [x] Verify two real authenticated accounts sharing attributed discussion, frozen whole-thread steering, queued input and safe-boundary application. The assistant operated both accounts; these were not independent human reviews.
- [x] Verify browser refresh/reconnection, missed-message recovery and continuation after a caught failure without losing the discussion.
- [x] Restore paired filesystem/native-context checkpoints while preserving discussion and a nonempty pending queue, without automatically rerunning work.
- [x] Verify native incremental text separately from final reply rendering and saved-history restoration.
- [x] Check first signup, task creation and access isolation against actual routes and real local Postgres with controlled GitHub responses.
- [x] Verify the existing owner's production reconnect/create/attach flow and anonymous API denials.
- [x] Verify one live Mem0 save and same-repository cross-task recall, followed by a correct source-task citation retest.
- [x] Deploy timestamp hydration fixes and check a fresh production page.
- [x] Verify anonymous access to the public GitHub repository on September 10 Pacific.
- [ ] Accept the new structured question → answer → continuation and review → revision → verification paths with real models and two production accounts.
- [ ] Complete a genuinely new GitHub account's first-signup production walkthrough.
- [ ] Recheck the final release with the second account, including authenticated cross-task and repository isolation.
- [ ] Complete live child-start, Stop and result acceptance for subagents.
- [ ] Verify live cross-repository memory isolation.
- [ ] Test reconnection during model deltas; the existing missed-human-message check is a different scenario.

## Operating limits

Provider 429 responses remain possible. Bounded retries stop; they do not create quota. Manual lost-run recovery preserves the discussion and queue but does not automatically resume execution after worker termination.

Historical Complete/Reopen checks describe a removed interface, not a current product requirement. Deployment success, local fixtures, saved production artifacts and new live execution are distinct evidence.
