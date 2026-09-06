# Hive — Submission goal

Deliver a working, shareable multiplayer coding agent and an evidence-backed take-home presentation.

## Current scope — 2026-09-05

The current user-provided goal explicitly excludes PR creation and multi-team management. Complete one real coding task, shared review, two-account collaboration, recovery, and the take-home materials. The September 4 discussion proposed PR handoff; that proposal is superseded for this goal and is not a completion gate. Normal authorized pushes and Vercel deployments of Hive itself remain part of implementation, not a product PR feature.

## Completion checklist

- [x] Complete a small change in a real attached repository; verify the checks, Runs, Files, and Diff (latest: formal task, 2026-09-06 05:22 UTC; 92 sandbox-revision tests, TypeScript, and diff check passed in one recorded command after continuation; artifacts survived refresh).
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

## Current rehearsal evidence

The formal task now retains a genuine accessible-label change, its changed-file snapshot, and a passing `pnpm test && pnpm typecheck && git diff --check` record from September 6. The change made before a 429 survived the failed run and subsequent successful continuation. Production Files rendered colored, read-only Monaco; the added Diff row was green. Preserve these artifacts and inspect them again before rehearsal; do not Reset the task or substitute fixture artifacts. This same-account verification does not complete the remaining two-account and network-loss checks.

The subsequent two-account check verified Joseph's discussion-only annotation, explicit promotion during a real check, disabled Apply until a safe boundary, and a new Joseph message queuing behind the active steer. The agent then misidentified the annotation author as the parent message author. Explicit authorship metadata and pre-repository steer forwarding are now covered by regressions, but the original live case must be repeated after release. Preserve the pending Joseph message; inspect its status before applying or sending anything again. The two-account completion gate remains open.

## Remaining boundaries

One team, one task per session, at most one repository attached at any time after creation. Agent conversation remains primary and annotations require explicit promotion to steer. Multi-team administration remains outside scope. Keep the repository private until the user approves publication; do not send submission messages without authorization.
