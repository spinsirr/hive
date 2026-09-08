# Hive — 20-minute presenter card

**Purpose:** keep the take-home demo focused on a working multiplayer coding task. This is the speaking outline, not a claim that a 20-minute narrated rehearsal has happened.

**Open beforehand:** the [real acceptance task](https://hive-roan-mu.vercel.app/sessions/label-the-return-to-latest-messa-qvezdg) as Spinsirr and josephmreb1 in separate browsers. The [public UI demo](https://hive-roan-mu.vercel.app/demo) uses sample data; it is optional design context, never execution evidence.

## Run of show

| Time | Show | Main point |
| --- | --- | --- |
| 0–3 min | The problem, before opening code | “Coding agents are usually private workspaces. Hive lets teammates participate while the agent is working, instead of reconstructing intent after it finishes.” |
| 3–10 min | One task in both accounts; Thread; Diff, Files and expanded Runs; bounded live check and queued Thread | Several humans control one agent. Discussion does not execute. A steer freezes which replies and authors become instructions. |
| 10–15 min | The three code boundaries below | The database grants one run, the state machine defines when it may start, and the prompt preserves authorship. |
| 15–18 min | Three decisions from the actual AI collaboration | Human direction changed the product; AI implemented and diagnosed; observable checks decided whether the output worked. |
| 18–20 min | Scope, limitations, questions | One team, one task, one late-attached repo. The product is the shared control loop, not another agent runtime. |

## The product segment

1. Check the identity menus, not just avatars. Show that the repository was attached after the task began.
2. Open the existing implementation Thread. Joseph specified the default accessible name and preserved caller override; Spinsirr required real regression checks and no pushing. The third localization reply was excluded. **“2 replies steered”** describes the old frozen boundary; do not click **Steer entire thread with 3 replies** on this discussion.
3. Show the actual two-file Diff and full file explorer. Expand the current combined check in Runs. Its recorded result is **125 sandbox-revision unit tests**, the controlled regressions and TypeScript passing, with **Exit 0**. These are not the deployed app's 135 local unit tests. Say that the implementation was completed beforehand and required repair guidance.
4. For the live-control portion, use a **new** human-only review Thread and the exact bounded prompts in the [full route](PRESENTATION_NOTES.md#demo-sequence-20-minutes). Two authors reply; one combined read-only check runs; Joseph queues the Thread while it is active; Spinsirr applies it only after inspecting the completed check.
5. Stop the live portion at minute nine even if it fails or is still running. Preserve the real state and move to code. If it finishes before queuing, name it an immediate-steer case; do not repeat work to manufacture a queue window.
6. Explain the Checkpoints boundary without restoring the prepared result. Complete → refresh → Reopen is optional when idle and the queue is empty; it was already verified in both accounts.

**Runs changes with the turn.** Show and inspect the check before applying the reply-only steer. That later turn may show **No commands in this turn**, correctly. It does not mean earlier tests disappeared from reality, and it is not a run-history viewer. Do not reset or restore merely to make the old result appear again.

## Three code boundaries

- **Who may run next?** [`canApplyNextSteer` and `reduceTaskSession`](../src/lib/task-session.ts) gate execution and freeze a Thread through `throughReplyId`.
- **What if two people act together?** [`applyTaskSessionAction`](../src/lib/task-session-store.ts) locks the task row, applies the transition and grants execution within that transaction.
- **Whose instruction is it?** [`buildHiveRunInput`](../src/lib/hive-prompt.ts) separates authors, promoter and execution starter. Resumed prompts avoid duplicating native agent history while retaining attributed human context.

Do not walk every file. Keep the [runner](../src/lib/hive-runner.ts), [restore implementation](../src/lib/workspace-restore.ts) and [live-session hook](../src/hooks/use-shared-session.ts) for Q&A.

## AI journey — speak in concrete examples

- **Spencer set the product direction:** a multiplayer agent conversation, not a long-lived team chat; one task per session; repository attachment can happen later.
- **Spencer challenged persistence:** a Codex session ID alone does not make sandbox history durable. Team history and paired recovery became explicit product boundaries.
- **AI work needed verification:** a shell exit zero masked failed edits, and a regression queried a deliberately hidden button. The supervising AI inspected real output, reproduced the defects, supplied a repair and verified the final sandbox command. Do not present that as a manual human fix or an autonomous first-pass success.

## What not to claim

- A successful continuation does not mean 429 is permanently resolved. Bounded retries stop; they do not create more quota.
- Two authenticated accounts were operated by the assistant during acceptance; that is not two independent human reviews.
- Paired checkpoint restore is not permanent-sandbox-deletion disaster recovery.
- No PR automation, issue triage, attachment ingestion, cross-task memory or multi-team administration is in this demo.
- The public dashboard preview is not a fake substitute for the real task.

## Before submission

Use the existing [two-paragraph summary](SUBMISSION.md#summary-blurb), confirmed by Spencer on September 8, 2026. Run the narrated rehearsal with a timer and record actual outcomes, not just elapsed browsing time. Public repository access and external sending still require separate explicit approval. The presentation is not scheduled yet; once it is, all four items must arrive at least 24 hours beforehand.
