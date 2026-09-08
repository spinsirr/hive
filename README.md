# Hive

One coding agent your whole team can work with.

Hive is a multiplayer coding agent for small software teams. Teammates share one task, one agent conversation, and one execution workspace. They can discuss the work in Threads, explicitly steer the agent, and review real code changes and checks together.

[Live application](https://hive-roan-mu.vercel.app/) · [Dashboard UI demo](https://hive-roan-mu.vercel.app/demo) · [Submission packet](docs/SUBMISSION.md)

## The problem

A coding agent often has one person holding the prompt, context, and workspace. Teammates see the result later in a screenshot or pull request, after important intent has already been lost.

Hive brings those teammates into the task while the code is being made. The distinction is shared control of the same agent—not separate agents behind a shared dashboard.

## Try the shared task

Reviewers need an **Invite** link and GitHub sign-in. The homepage alone does not admit a new account, and making the code repository public does not grant application access.

1. Create a task and invite a teammate. Attach one authorized repository whenever the team is ready to work on code.
2. Talk to Hive, or use a leading `@teammate` mention for human-only discussion.
3. Open **Reply** on a message. Replies stay discussion until someone chooses **Steer Hive** or **Steer thread**.
4. While Hive runs, new agent-directed input queues. Apply the next steer explicitly when the current run ends.
5. Inspect **Diff**, browse **Files**, and expand the actual command output in **Runs**. Approve a successful nonempty diff, then complete the task; reopen it if work continues.

**Steer thread freezes the discussion so far.** Authors remain distinct from the person promoting or applying it; later replies do not silently change the queued instruction.

The public `/demo` route uses the real dashboard component with invented, page-local sample data. It supports Active / Completed, New task, and Empty state without a database or model. It is UI context, not execution evidence.

## How it works

| Layer | Responsibility |
| --- | --- |
| Next.js | Full-stack UI, authenticated routes, and task actions, deployed on Vercel. |
| GitHub OAuth + GitHub App | Human identity and invitations; separate repository-scoped installation tokens for Sandbox access. |
| Neon Postgres via Vercel Marketplace | Canonical conversation, membership, queue, lifecycle, and private recovery state. Row locks serialize accepted input. |
| AI SDK Harness + Codex | Existing coding runtime that inspects, edits, and runs real repository commands. |
| Vercel AI Gateway + Sandbox | Model access through Vercel OIDC and isolated execution of the selected repository. |
| WebSockets, Streamdown, and Monaco | Shared live updates, incremental Markdown replies, and read-only source navigation with code annotations. |

The database transition grants one run; a browser timestamp is not a lock. Public text is checkpointed in batches, and reconnect reads saved state without launching another turn. Tool output belongs in Runs, not assistant chat; private Codex resume data never goes to the browser.

Three useful code boundaries:

- [Task state machine](src/lib/task-session.ts): discussion, frozen Thread input, ordered steers, approval, and lifecycle.
- [Task store](src/lib/task-session-store.ts): row-locked transitions, deduplicated submissions, and shared state.
- [Prompt construction](src/lib/hive-prompt.ts): distinct authors, promoter, and execution starter without duplicating native agent history.

The [runner](src/lib/hive-runner.ts), [restore path](src/lib/workspace-restore.ts), and [streaming diagnosis](docs/STREAMING_DIAGNOSIS.md) cover execution and recovery in more detail.

## Key decisions and limits

- **One task per session.** One team, one late-attached repository, one mutating run at a time. The session is an outcome, not a permanent team room.
- **Discussion is not execution.** Threads and selected-code annotations need explicit steering. The queue waits for a run boundary; teammates choose when to apply the next item.
- **Rollback the work, not the team.** Restore pairs files with their native agent context, preserves discussion and pending steers, and invalidates approval. Three recovery points are normally retained; unmatched snapshots cannot be restored.
- **Artifacts over summaries.** Files browses the existing worktree, including unchanged files. Monaco supports selection and annotations, not file saves. Credential files, Git internals, symlinks, binary files, and text over 512 KB are not previewed.
- **Show honest failures.** Runs displays process exit codes and original output, not an inferred test verdict. It shows the latest turn, so a later text-only reply can correctly show no commands.
- **Bound the submission.** No PR creation, sandbox branch push, issue triage, uploads, cross-task memory, or multi-team administration. Vercel Workflow is deferred under the [scope freeze](docs/GOAL.md#submission-scope-freeze--september-8). Browser reconnection and caught-failure checkpoints do not guarantee automatic recovery after hard worker termination.

GitHub sign-in uses invitation-only admission. Joining a task admits a member to the team's authorized repository pool, not just that task's repository. Installation tokens are short-lived and scoped to the selected clone. Keep credentials server-side and non-production deployments protected.

## Run locally

Use Node.js with native TypeScript execution (recorded checks used v25.2.1), pnpm 11.19.0, an authenticated Vercel CLI, a development Postgres database, and a GitHub App. Configure `.env.local` from [`.env.example`](.env.example) with development credentials before migrating.

```bash
pnpm install
pnpm db:migrate
vercel dev
```

Open [localhost:3000](http://localhost:3000). The verified GitHub App owner can bootstrap the team; other accounts require invitations. The App must be public to authorize other GitHub users—this is separate from the code repository's visibility.

Register the App's Setup URL as `https://your-domain.example/api/github/setup` and callback as `https://your-domain.example/api/github/callback`. For local sign-in, use the localhost callback from `.env.example`. Login begins on the configured callback origin so the host-only OAuth nonce survives the round trip.

`DATABASE_URL_DIRECT` must reach the same database directly for `LISTEN/NOTIFY`; a transaction pool is not suitable for the listener. Live WebSocket connections use the Vercel runtime and Fluid compute. Plain `pnpm dev --webpack --hostname 127.0.0.1` is useful for UI development and `/demo`, but does not provide the Vercel live-session connection. See [Vercel WebSockets](https://vercel.com/docs/functions/websockets).

Production model access uses Vercel OIDC. Coding defaults to `openai/gpt-5.1-codex-mini` with low reasoning; planning uses `openai/gpt-5-mini`. The example configuration documents both overrides. There is no automatic model fallback or credit purchase. Rejected HTTP 429 requests have bounded backoff; entire turns and accepted streams are not automatically replayed. Remaining balance does not mean unlimited request capacity.

## Verification

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm exec next build --webpack
```

`pnpm test` includes 138 unit tests plus controlled runner, route, native-stream, and real-component regressions. Coverage includes authorship, invitation admission, deduplication, queue boundaries, frozen Threads, IME input, file-read safety, paired restore, reconnect ordering, lightweight presence, caching, and scrolling. External boundaries are doubled in these local checks.

For real Postgres/live-route egress regression coverage, set `HIVE_EGRESS_TEST_DATABASE_URL` to a **local loopback** Postgres server with a role that can create databases, then run `pnpm test:session-egress`. The check creates and removes its own uniquely named fixture database. It does not load `.env.local`, contact Neon, use real accounts, or call a model. It verifies heartbeat fanout without task reads and SQL-side exclusion of private recovery data. See the [September 8 incident](docs/PRESENTATION_NOTES.md#september-8--neon-egress-incident) for measurements and production availability limits.

On September 8, the independent real-repository task completed `pnpm test && pnpm typecheck && git diff --check` with Exit 0. Its older Sandbox checkout passed **125 unit tests**, component regressions, TypeScript, and diff validation. Both real GitHub accounts inspected the two-file change and attributed response, then verified approval and Complete → refresh → Reopen. Earlier checks separately verified queued Threads, excluded later replies, native incremental text, offline recovery, and paired restore with pending input.

The supervising AI operated both authenticated accounts and supplied a tested repair after earlier agent failures. This was not two independent human reviews or an autonomous first-pass success. Provider 429 risk remains; these checks do not prove hard-worker-crash or permanent-Sandbox-deletion recovery.

The [dated evidence log](docs/PRESENTATION_NOTES.md#evidence-log) records successes, failures, versions, and test limitations. Technical checks do not substitute for the remaining timed rehearsal, fresh reviewer access, or publication approval.

## AI collaboration and presentation

AI helped explore product directions, build the full-stack slice, diagnose failures, and write regression tests. Spencer repeatedly redirected the work: agent conversation first, one task per session, late repository attachment, explicit steering, real execution artifacts, and persistence beyond a Sandbox session ID.

Verification also changed the result. A command swallowed failed edits behind exit zero, and an AI-written regression queried a deliberately hidden button. The supervising AI reproduced the failures, corrected the misleading verdict, supplied a repair, and checked real output. Those interventions are part of the story.

Use the [20-minute presenter card](docs/DEMO_BRIEF.md) for problem → solution → code → AI journey. The [submission packet](docs/SUBMISSION.md) contains the owner-confirmed two-paragraph introduction and access checklist. The repository remains private until the owner authorizes publication; nothing has been submitted.
