# Hive — Submission packet

Draft prepared for owner review. Not yet submitted; the remaining live acceptance checks and reviewer access are not complete.

Release note: the owner authorized pushing and deploying the new dashboard/UI demo, Thread/whole-thread steering and paired rollback on September 7. Reconcile this packet with the exact deployment and live checks recorded in the evidence log before sending; the earlier multiplayer acceptance does not verify these additions. This release authorization does not authorize repository publication or external submission.

## Four submission items

| Item | Location | Before sending |
| --- | --- | --- |
| GitHub repository and commit history | [spinsirr/hive](https://github.com/spinsirr/hive) | Keep private until the owner explicitly approves publication. Then verify access while signed out. |
| Live application | [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/) | Supply a task invitation to reviewers and test their fresh GitHub sign-in. The homepage alone does not admit a new account. |
| Written overview | [README](../README.md) | Reconcile the verification section with the final deployed release. |
| One-to-two-paragraph summary | Below | Spencer should review and personalize it before it is sent in his own words. |

## Summary blurb

Hive is a multiplayer coding agent for small software teams. Instead of one person privately prompting an agent and handing the result to teammates later, everyone shares the same task-scoped conversation and execution workspace. Teammates can talk directly to one another, annotate a specific message, or deliberately promote an annotation into a steer for Hive. The point is to keep the team's intent present while the code is being made, not just when it is reviewed afterward.

I built Hive as a focused Next.js full-stack product. GitHub sign-in establishes authorship, invitations admit teammates, and Postgres preserves the shared conversation and serializes their input. An existing Codex harness runs inside Vercel Sandbox; teammates inspect actual commands, changed files, and diffs. I concentrated on the multiplayer interaction—discussion versus direction, explicit queue boundaries, and shared review—rather than building another agent runtime or adding PR automation and organization management.

## Readiness gates

- The two-real-account annotation → steer → queue → execution sequence passed on September 6 at 07:09 UTC, including the corrected attribution case. Cross-account completion/reopening also passed; retain these results for rehearsal.
- Native text streaming is now [deployed and verified](STREAMING_DIAGNOSIS.md): the 2026-09-07 00:19 UTC run showed 25 growing updates before completion and one final reply, restored identically by a fresh page. Failed-run continuation, offline-page reload recovery, and no-reload recovery of a missed teammate message passed separately. The latter is not an offline-mid-model-delta test; do not describe fixture tests as production evidence.
- Preserve and recheck the real coding result before the demo. A fresh owner-page inspection at **2026-09-07 17:43 UTC** found the original accessibility Diff, the full Files tree (including the unchanged README), and the original successful combined command with 92 sandbox-revision tests in Runs. This was read-only navigation, not a new run or two-account check. A later text-only turn would replace that latest-turn command view, so inspect command evidence before applying a text-only steer. Do not Reset the task for a cleaner transcript.
- Rehearse the [20-minute route](PRESENTATION_NOTES.md#demo-sequence-20-minutes) with a timer, including problem → solution → code → AI journey.
- The read-only technical route has been checked in production; the script includes the exact annotation/check prompts and a slow/failure path. Its 170-second navigation preflight is not proof of a 20-minute narrated rehearsal. The bounded local-history credential-pattern check is also not a complete publication audit.
- Confirm the presentation date and time. Send all four items at least 24 hours beforehand; do not invent a calendar deadline before the presentation is scheduled.
- Obtain the owner's explicit approval before changing repository visibility or sending materials. No invite token, credential, or private participant information belongs in the public README.

The presentation is 90 minutes in total, with about 20 minutes of demo and the remainder for discussion. The [evidence log](PRESENTATION_NOTES.md#evidence-log) and [goal checklist](GOAL.md) remain the detailed readiness record.
