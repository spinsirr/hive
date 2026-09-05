# Hive — Submission goal

Deliver a working, shareable multiplayer coding agent and an evidence-backed take-home presentation.

## Current scope — 2026-09-05

The current user-provided goal explicitly excludes PR creation and multi-team management. Complete one real coding task, shared review, two-account collaboration, recovery, and the take-home materials. The September 4 discussion proposed PR handoff; that proposal is superseded for this goal and is not a completion gate. Normal authorized pushes and Vercel deployments of Hive itself remain part of implementation, not a product PR feature.

## Completion checklist

- [x] Complete a small change in a real attached repository; verify the checks, Runs, Files, and Diff (formal task, 2026-09-05 05:22 UTC; 27 sandbox-revision tests, TypeScript, and diff check passed after continuation).
- [x] Make Invite and Complete accessible at narrow viewport widths (375px local interaction fixture; production controls verified at 737px).
- [ ] Verify two real GitHub users sharing a task: attribution, annotations, steering during a run, queue ordering, and synchronization.
- [ ] Verify refresh, reconnect, and continuation after a failed run preserve messages and execution context.
- [x] Add a read-only Monaco file viewer with file navigation and syntax highlighting (production changed-file snapshot rendered for the completed accessibility change).
- [x] Add and verify teammate autocomplete when typing `@` in the conversation composer (production task, actual teammate `josephmreb1`).
- [ ] Finish loading, empty, and error states plus task completion and reopening.
- [x] Verify the production task's Complete → refresh → Reopen cycle with owner approval (2026-09-05 05:38 UTC): read-only state persisted across refresh; reopening restored collaboration controls without losing the transcript or diff. Cross-account lifecycle synchronization remains unverified.
- [x] Prevent approval of empty or ineligible diffs in both the state machine and UI; verified with regression tests and the real local component. Production rollout is recorded separately in the evidence log.
- [x] Prepare the README, one-to-two-paragraph summary, decision log, and AI collaboration evidence; the [submission packet](SUBMISSION.md) links the material and explicitly lists unverified claims.
- [ ] Have the owner review the summary in their own words and update verification results after the remaining live checks.
- [ ] Rehearse the approximately 20-minute demo and verify the deployed app and submission links.
- [ ] With the user's approval, make the repository public and send all four submission items at least 24 hours before the presentation.

Record completed checks and their limitations in `PRESENTATION_NOTES.md`. Distinguish implementation from live verification. Two-user testing requires two real authenticated accounts.

## Rehearsal evidence to re-establish

The formal task no longer displayed the earlier successful diff on the latest production inspection. Preserve the current task state and rerun a genuine, bounded coding/review exercise for the rehearsal; do not reinsert old or fixture artifacts. The earlier checks above remain dated historical evidence. Current same-account refresh recovery is not a substitute for the remaining two-account and in-flight reconnect checks.

## Remaining boundaries

One team, one task per session, at most one repository attached at any time after creation. Agent conversation remains primary and annotations require explicit promotion to steer. Multi-team administration remains outside scope. Keep the repository private until the user approves publication; do not send submission messages without authorization.
