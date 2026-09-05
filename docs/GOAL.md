# Hive — Submission goal

Deliver a working, shareable multiplayer coding agent and an evidence-backed take-home presentation.

## Scope update — 2026-09-04

The user added branch push and pull-request creation to the active goal. This supersedes the original goal's exclusion of PR creation. The existing priority order remains: prove real coding and multiplayer collaboration, then complete the review and delivery experience.

## Completion checklist

- [x] Complete a small change in a real attached repository; verify the checks, Runs, Files, and Diff (formal task, 2026-09-05 05:22 UTC; 27 sandbox-revision tests, TypeScript, and diff check passed after continuation).
- [x] Make Invite and Complete accessible at narrow viewport widths (375px local interaction fixture; production controls verified at 737px).
- [ ] Verify two real GitHub users sharing a task: attribution, annotations, steering during a run, queue ordering, and synchronization.
- [ ] Verify refresh, reconnect, and continuation after a failed run preserve messages and execution context.
- [x] Add a read-only Monaco file viewer with file navigation and syntax highlighting (production changed-file snapshot rendered for the completed accessibility change).
- [x] Add and verify teammate autocomplete when typing `@` in the conversation composer (production task, actual teammate `josephmreb1`).
- [ ] Add explicit PR creation after reviewing the shared diff; verify the real GitHub result.
- [ ] Finish loading, empty, and error states plus task completion and reopening.
- [x] Prevent approval of empty or ineligible diffs in both the state machine and UI; verified with regression tests and the real local component. Production rollout is recorded separately in the evidence log.
- [ ] Finish the README, one-to-two-paragraph summary, decision log, and AI collaboration evidence.
- [ ] Rehearse the approximately 20-minute demo and verify the deployed app and submission links.
- [ ] With the user's approval, make the repository public and send all four submission items at least 24 hours before the presentation.

Record completed checks and their limitations in `PRESENTATION_NOTES.md`. Distinguish implementation from live verification. Two-user testing requires two real authenticated accounts.

## PR handoff acceptance

1. A teammate reviews the current diff and explicitly chooses Create PR, with a reviewable title and description.
2. Hive commits the actual task workspace to a dedicated branch in the attached repository and opens a PR against its base branch. Display snapshots may be truncated and are not the source for publication.
3. The session persists the real PR URL and shows it to all members, including after refresh.
4. Concurrent clicks and retries do not create duplicate branches or PRs. A failed request leaves a clear, retryable state.
5. Publishing coordinates with the shared run state so the agent cannot change the reviewed workspace during publication.
6. Publication uses repository-scoped GitHub App write permissions. The agent's normal execution credentials remain read-only.
7. Merging remains a separate GitHub action. Creating a PR does not automatically merge it or complete the Hive task.

## Remaining boundaries

One team, one task per session, at most one repository attached at any time after creation. Agent conversation remains primary and annotations require explicit promotion to steer. Multi-team administration remains outside scope. Keep the repository private until the user approves publication; do not send submission messages without authorization.
