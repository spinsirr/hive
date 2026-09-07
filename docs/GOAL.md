# Hive — Submission goal

Deliver a working, shareable multiplayer coding agent and an evidence-backed take-home presentation.

## Current scope — 2026-09-05

The current user-provided goal explicitly excludes PR creation and multi-team management. Complete one real coding task, shared review, two-account collaboration, recovery, and the take-home materials. The September 4 discussion proposed PR handoff; that proposal is superseded for this goal and is not a completion gate. Normal authorized pushes and Vercel deployments of Hive itself remain part of implementation, not a product PR feature.

## Completion checklist

- [x] Complete a small change in a real attached repository; verify the checks, Runs, Files, and Diff (latest real check: formal task, 2026-09-07 00:19 UTC; 92 sandbox-revision tests, TypeScript, and diff check passed in one recorded command; both accounts previously inspected the retained workspace).
- [x] Make Invite and Complete accessible at narrow viewport widths (375px local interaction fixture; production controls verified at 737px).
- [x] Verify two real GitHub users sharing a task: attribution, annotations, steering during a run, queue ordering, and synchronization (original Joseph-author / owner-applier case passed at 07:09 UTC; the earlier queued message was applied once at 06:44).
- [x] Verify refresh, reconnect, and continuation after a failed run preserve messages and execution context. In addition to failed-run continuation and offline-page reload recovery, the 07:28 UTC no-reload check recovered one missed teammate message and the unsent draft, with a new live WebSocket handshake and no agent wake-up.
- [x] Add a read-only Monaco file viewer with file navigation and syntax highlighting (production changed-file snapshot rendered for the completed accessibility change).
- [x] Add and verify teammate autocomplete when typing `@` in the conversation composer (production task, actual teammate `josephmreb1`).
- [x] Finish loading, empty, and error states plus task completion and reopening (controlled delivery/empty/error checks, live retained 429 state, deployed latest-turn command empty state, and cross-account lifecycle check).
- [x] Verify the production task's Complete → refresh → Reopen cycle with owner approval (latest: 2026-09-06 07:13–07:14 UTC): owner completion reached both browsers; Joseph refreshed the read-only task and reopened it; the owner's controls recovered and the transcript/diff remained.
- [x] Prevent approval of empty or ineligible diffs in both the state machine and UI; verified with regression tests and the real local component. Production rollout is recorded separately in the evidence log.
- [x] Prepare the README, one-to-two-paragraph summary, decision log, and AI collaboration evidence; the [submission packet](SUBMISSION.md) links the material and explicitly lists unverified claims.
- [x] Release the Thread/whole-thread steering, paired rollback, dashboard and UI-demo changes with owner authorization. `fec2484` received a successful Vercel status on September 7; the canonical dashboard/demo, Thread rendering and retained workspace passed the bounded live UI check.
- [ ] Verify a new two-account Thread/whole-thread execution and a real paired checkpoint restore before presenting those additions as production-verified. Their deterministic regressions and read-only live checks do not replace execution acceptance.
- [ ] Have the owner review the summary in their own words and update verification results after the remaining live checks.
- [x] Resolve the failed incremental-text acceptance check: native app-server deltas deployed in `4a1abb3`. Production observation at 2026-09-07 00:19 UTC recorded 25 growing updates before completion, one final reply and successful real checks. A fresh page restored the identical reply. See [diagnosis and acceptance](STREAMING_DIAGNOSIS.md).
- [x] Check the read-only presentation navigation and retained artifacts on production; the 170-second owner-side preflight and separate Joseph identity/response check are recorded in the evidence log. This is not the full narrated rehearsal below.
- [ ] Rehearse the approximately 20-minute demo and verify the deployed app and submission links.
- [ ] With the user's approval, make the repository public and send all four submission items at least 24 hours before the presentation.

Record completed checks and their limitations in `PRESENTATION_NOTES.md`. Distinguish implementation from live verification. Two-user testing requires two real authenticated accounts.

## Current rehearsal evidence

The September 7 release check at **18:04 UTC** confirmed the new dashboard and Thread UI on the canonical production site. Existing authored replies, the original Diff, full Files tree and successful 92-test sandbox command were preserved. No model execution, task mutation, or restore was performed; only page-local sample data was created/reset in the public `/demo`. Detailed observations are in the evidence log.

Read-only revalidation on **2026-09-07 17:43 UTC** confirmed the canonical task after an owner-page refresh: the original accessibility Diff, the successful combined command with 92 passing sandbox-revision tests, and both changed/unchanged files in the full tree remain inspectable. No new run or two-account action was performed. The homepage returns 200; unauthenticated task API access returns 401; GitHub still reports the repository private. These checks do not close the pending local release or timed rehearsal gates.

The formal task retains the genuine accessible-label change and its changed-file snapshot. The latest combined check ran at **2026-09-07 00:19 UTC**, after the native-streaming fix; its actual 92-test/typecheck output was expanded and verified Passed. Both accounts had already inspected the same workspace and an earlier real check. Runs shows only the latest turn, so do not send an extra text-only turn before presenting that command evidence. Recheck it before rehearsal; do not Reset the task or substitute fixture artifacts.

The original two-account attribution failure is fixed and retested. Joseph saved the same annotation wording at 07:04 without waking Hive, queued it during the owner's real check at 07:05, and waited while Apply was disabled. After the owner applied it at 07:08, both browsers received the correct Joseph-authored answer at 07:09. Together with the retained ordinary message's single execution at 06:44, this closes the multiplayer sequence gate. No queued work remains.

The multiplayer and recovery checks used `356c525`, including the attribution fix and corrected command empty state. After crossing the connection's normal rollover offline, Joseph recovered one missed human-only message exactly once, retained the draft, and established a new 101 live WebSocket connection without refreshing. Offline-page reload during another teammate's run also recovered the task. Test network settings were restored, drafts cleared without sending, and DevTools closed. The subsequent incremental-text check initially failed; `4a1abb3` now passes it on production. This last retest used the owner's page and a fresh owner page, not a new two-account or offline-mid-delta rehearsal. The timed rehearsal remains open; repository publication and submission still need owner approval.

## Remaining boundaries

One team, one task per session, at most one repository attached at any time after creation. Agent conversation remains primary; thread replies and code annotations require explicit promotion to steer, individually or as a frozen whole discussion. User-requested checkpoint rollback restores files and agent context together without rewinding team conversation or running the queue. Threads and rollback have deterministic/local UI coverage; a two-account production check of these additions is still separate from the earlier multiplayer evidence. Image/file uploads remain pending private-storage configuration and agent ingestion. Multi-team administration remains outside scope. Keep the repository private until the user approves publication; do not send submission messages without authorization.
