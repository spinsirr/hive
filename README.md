# Hive

One coding agent your whole team can work with.

Hive is a multiplayer coding agent for small software teams. Teammates share one task, one agent conversation, and one execution workspace. They can discuss the work in Threads, explicitly steer the agent, and review real code changes and checks together.

[Live application](https://hive-roan-mu.vercel.app/) · [Dashboard UI demo](https://hive-roan-mu.vercel.app/demo) · [Submission packet](docs/SUBMISSION.md)

## The problem

A coding agent often has one person holding the prompt, context, and workspace. Teammates see the result later in a screenshot or pull request, after important intent has already been lost.

Hive brings those teammates into the task while the code is being made. The distinction is shared control of the same agent—not separate agents behind a shared dashboard.

## Try the shared task

First-time visitors can sign in with GitHub and create their own tasks. A new account starts with an empty dashboard. To review or collaborate on someone else's task, open its **Invite** link; signing in alone does not grant access to existing tasks.

1. Create a task and invite a teammate. Attach one repository authorized for your GitHub account whenever the task is ready for code.
2. Talk to Hive, or use a leading `@teammate` mention for human-only discussion.
3. Open **Reply** on a message. Replies stay discussion until someone chooses **Steer Hive** or **Steer thread**.
4. While Hive runs, new agent-directed input queues. Apply the next steer explicitly when the current run ends.
5. Inspect **Diff**, browse **Files**, and expand the actual command output in **Runs**. Approve a successful nonempty diff; continue the conversation or steer again in the same task.

**Steer thread freezes the discussion so far.** Authors remain distinct from the person promoting or applying it; later replies do not silently change the queued instruction.

The public `/demo` route uses the real dashboard component with invented, page-local sample data. It supports a recent-first task list, New task, and Empty state without a database or model. It is UI context, not execution evidence.

## How it works

| Layer | Responsibility |
| --- | --- |
| Next.js | Full-stack UI, authenticated routes, and task actions, deployed on Vercel. |
| GitHub OAuth + GitHub App | Human identity and live user-scoped repository discovery; separate repository-scoped installation tokens for Sandbox access. |
| Neon Postgres via Vercel Marketplace | Canonical conversation, membership, queue, review, and private recovery state. Row locks serialize accepted input. |
| AI SDK Harness + Codex | Existing coding runtime that inspects, edits, and runs real repository commands. |
| Vercel AI Gateway + Sandbox | Model access through Vercel OIDC and isolated execution of the selected repository. |
| WebSockets, Streamdown, and Monaco | Shared live updates, incremental Markdown replies, and read-only source navigation with code annotations. |

The database transition grants one run; a browser timestamp is not a lock. Public text is checkpointed in batches, and reconnect reads saved state without launching another turn. Tool output belongs in Runs, not assistant chat; private Codex resume data never goes to the browser.

Three useful code boundaries:

- [Task state machine](src/lib/task-session.ts): discussion, frozen Thread input, ordered steers, and approval.
- [Task store](src/lib/task-session-store.ts): row-locked transitions, deduplicated submissions, and shared state.
- [Prompt construction](src/lib/hive-prompt.ts): distinct authors, promoter, and execution starter without duplicating native agent history.

The [runner](src/lib/hive-runner.ts), [restore path](src/lib/workspace-restore.ts), and [streaming diagnosis](docs/STREAMING_DIAGNOSIS.md) cover execution and recovery in more detail.

## Key decisions and limits

- **One task per session.** One team, one late-attached repository, one mutating run at a time. The session is an outcome, not a permanent team room. A finished run or approved diff does not close the conversation; there is no manual Complete/Reopen step.
- **Discussion is not execution.** Threads and selected-code annotations need explicit steering. The queue waits for a run boundary; teammates choose when to apply the next item.
- **Rollback the work, not the team.** Restore pairs files with their native agent context, preserves discussion and pending steers, and invalidates approval. Three recovery points are normally retained; unmatched snapshots cannot be restored.
- **Artifacts over summaries.** Files browses the existing worktree, including unchanged files. Monaco supports selection and annotations, not file saves. Credential files, Git internals, symlinks, binary files, and text over 512 KB are not previewed.
- **Show honest failures.** Runs displays process exit codes and original output, not an inferred test verdict. It shows the latest turn, so a later text-only reply can correctly show no commands.
- **Bound the submission.** No PR creation, sandbox branch push, issue triage, uploads, or multi-team administration. Vercel Workflow remains deferred. The owner's subsequent, narrow request for repository memory is described below; it is not yet a verified live capability. Browser reconnection and caught-failure checkpoints do not guarantee automatic recovery after hard worker termination.

Task membership and GitHub repository access are separate. An invitation shares only that task's conversation and attached working copy, not the inviter's other tasks or repository pool. Repository listing and attachment both query GitHub using the current user's access token, including when several users share an App installation. The user's encrypted, HttpOnly GitHub cookie is bound to one Hive login, expires within eight hours (or sooner if GitHub specifies), and is cleared on logout. Missing, expired or revoked authorization asks for **Reconnect GitHub**; it never falls back to App-wide access. The existing OAuth client secret derives a purpose-specific encryption key; invitation signing is unchanged and no new secret or database migration is required. [GitHub's user-scoped repository API](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token).

Installation tokens remain short-lived and scoped to the selected clone. The GitHub user token is never sent to the Sandbox, placed in a task transcript, or included in a repository API response. Keep non-production deployments protected.

## Run locally

Use Node.js with native TypeScript execution (recorded checks used v25.2.1), pnpm 11.19.0, an authenticated Vercel CLI, a development Postgres database, and a GitHub App. Configure `.env.local` from [`.env.example`](.env.example) with development credentials before migrating.

```bash
pnpm install
pnpm db:migrate
vercel dev
```

Open [localhost:3000](http://localhost:3000) and sign in to create a task. The App must be public to authorize other GitHub users—this is separate from the code repository's visibility. Use **Connect your GitHub** or **Manage GitHub access** in an unattached task to select repositories for the App.

Register the App's Setup URL as `https://your-domain.example/api/github/setup` and callback as `https://your-domain.example/api/github/callback`. For local sign-in, use the localhost callback from `.env.example`. Login begins on the configured callback origin so the host-only OAuth nonce survives the round trip.

`DATABASE_URL_DIRECT` must reach the same database directly for `LISTEN/NOTIFY`; a transaction pool is not suitable for the listener. Live WebSocket connections use the Vercel runtime and Fluid compute. Plain `pnpm dev --webpack --hostname 127.0.0.1` is useful for UI development and `/demo`, but does not provide the Vercel live-session connection. See [Vercel WebSockets](https://vercel.com/docs/functions/websockets).

Production model access uses Vercel OIDC. Coding defaults to `openai/gpt-5.1-codex-mini` with low reasoning; planning uses `openai/gpt-5-mini`. The example configuration documents both overrides. There is no automatic model fallback or credit purchase. Rejected HTTP 429 requests have bounded backoff; entire turns and accepted streams are not automatically replayed. Remaining balance does not mean unlimited request capacity.

### Task tools and optional Mem0 memory

**Locally verified; real Mem0 save/recall acceptance is pending.** In a coding run, Hive's native Codex MCP tools can read bounded, attributed task context and reply to an existing Thread as Hive. Replies are discussion: they do not start a run, drain the queue, approve work, or restore checkpoints. The bundled [collaboration skill](src/lib/codex-bridge/hive-collaboration/SKILL.md) explains those boundaries and the Sandbox environment without replacing native history.

Set `MEM0_API_KEY` on the **Hive server only** to enable automatic recall. The existing `HarnessAgent.prepareCall` hook searches once before a fresh coding turn, using the selected message/reply, or the task title for a whole-thread steer. It does not upload the expanded team prompt. Queries longer than 1,000 characters or matching the existing obvious-secret/code-fence guard are skipped. Up to three scoped memories are added as untrusted user-context data with bounded author/source fields; the current task remains last and takes precedence. Empty results, errors and a two-second deadline leave the original prompt unchanged, with no retries. Tool steps, suspended-turn continuations, opening a task and human-only discussion do not trigger another automatic lookup.

The optional MCP tools additionally require `HIVE_INVITE_SECRET` and the canonical `GITHUB_APP_CALLBACK_URL`. The Sandbox must be able to reach that origin; localhost configuration is not reachable from a remote Sandbox. Each run receives a five-minute task/member/run-scoped capability, never the Mem0 key. Calls recheck current membership and the active run; code artifacts and private native recovery data are excluded from tool-context SQL. Host-side automatic recall does not require this callback capability and does not mint or rotate invitation keys.

Both automatic recall and the optional `search_memory` tool use the same **GitHub installation + repository** scope, not the whole organization. The tool remains available for a different specific topic or an explicitly requested search, not redundant per-step lookup. On an explicit human request, `remember_memory` selects one saved human message/reply by ID and stores its short text verbatim, with author and source IDs, using Mem0's `infer: false`. Consent is instructed by the skill, not a new approval UI; server-side checks constrain the source and reject obvious secrets/code fences but are not a comprehensive secret detector. No automatic transcript ingestion, background memory polling, blind write retry, or claimed save on a pending result. A missing key or memory outage does not remove the coding tools. [Mem0 add API](https://docs.mem0.ai/api-reference/memory/add-memories).

## Verification

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm exec next build --webpack
```

`pnpm test` includes unit tests plus controlled runner, route, native-stream, and real-component regressions. Coverage includes authorship, invitation signing, deduplication, queue boundaries, frozen Threads, IME input, file-read safety, paired restore, reconnect ordering, connection-owned presence, multi-tab deduplication, instance expiry, caching, scrolling, scoped MCP tools and Mem0 request/response boundaries. External services are doubled in these local checks; the MCP client and transport are real.

`scripts/check-memory-recall.mjs` uses the installed Harness SDK with controlled native-runtime and Mem0 HTTP boundaries. It verifies per-turn recall, multiple tool steps, fresh-process suspended continuation without another lookup, attribution, scope filtering, bounded provenance, unsafe-query skips and a stalled request that cannot block coding. The runner regression separately verifies that this hook is wired into coding execution. These are not live Mem0 or model-behavior claims.

For onboarding and authorization, set `HIVE_ONBOARDING_TEST_DATABASE_URL` to a **local loopback** Postgres server with database-creation permission, then run `pnpm test:onboarding`. It creates and drops only its uniquely named fixture database. Actual OAuth routes, session persistence, task creation, task pages and protected APIs verify first signup, empty dashboard, task invitations, user-scoped GitHub listing/attachment, credential expiry and account isolation. GitHub HTTP is controlled; no real account, Neon database, Sandbox or model is contacted. This is not a substitute for a fresh-account production walkthrough.

For real Postgres/live-route egress regression coverage, set `HIVE_EGRESS_TEST_DATABASE_URL` to a **local loopback** Postgres server with a role that can create databases, then run `pnpm test:session-egress`. The check creates and removes its own uniquely named fixture database. It does not load `.env.local`, contact Neon, use real accounts, or call a model. It measures 31 seconds of idle connections, verifies typing and multi-tab presence without presence-table/task reads, and retains SQL-side exclusion of private recovery data. See the [September 8 incident](docs/PRESENTATION_NOTES.md#september-8--neon-egress-incident) for historical measurements and production availability limits.

That database check also covers the signed agent-tool route, bounded bodies, retry-safe replies, and revoked/stale-run access. For native integration, `node scripts/diagnostics/check-hive-tools.mjs /path/to/isolated/sdk-install` requires an isolated `@openai/codex-sdk@0.149.1` installation. It runs the real Codex process against loopback model and Mem0 fixtures, verifying skill loading, same-thread history, tool execution and cross-task recall—not real model behavior or Mem0 Cloud availability.

Presence follows authenticated WebSocket connections, not a periodic HTTP request or a stored `last_seen` value. Native ping/pong checks the browser connection every 20 seconds without SQL. Existing Postgres `NOTIFY` relays only member IDs and typing flags across instances; each active instance/task renews its small announcement every 30 seconds, without table writes or repeated reads on receipt. Normal disconnects publish a leave; an ungraceful instance loss expires after 90 seconds. This is reduced database traffic, not zero database traffic. The retired presence table is unused but retained; no destructive migration is required. See [connection-presence evidence](docs/PRESENTATION_NOTES.md#september-8--connection-owned-presence).

On September 8, the independent real-repository task completed `pnpm test && pnpm typecheck && git diff --check` with Exit 0. Its older Sandbox checkout passed **125 unit tests**, component regressions, TypeScript, and diff validation. Both real GitHub accounts inspected the two-file change and attributed response, then verified approval and the then-existing Complete → refresh → Reopen flow. Manual task completion was [removed on September 9](docs/PRESENTATION_NOTES.md#september-9--execution-completion-is-not-conversation-closure). Earlier checks separately verified queued Threads, excluded later replies, native incremental text, offline recovery, and paired restore with pending input.

The supervising AI operated both authenticated accounts and supplied a tested repair after earlier agent failures. This was not two independent human reviews or an autonomous first-pass success. Provider 429 risk remains; these checks do not prove hard-worker-crash or permanent-Sandbox-deletion recovery.

The [dated evidence log](docs/PRESENTATION_NOTES.md#evidence-log) records successes, failures, versions, and test limitations. Technical checks do not substitute for the remaining timed rehearsal, fresh reviewer access, or publication approval.

## AI collaboration and presentation

AI helped explore product directions, build the full-stack slice, diagnose failures, and write regression tests. Spencer repeatedly redirected the work: agent conversation first, one task per session, late repository attachment, explicit steering, real execution artifacts, and persistence beyond a Sandbox session ID.

Verification also changed the result. A command swallowed failed edits behind exit zero, and an AI-written regression queried a deliberately hidden button. The supervising AI reproduced the failures, corrected the misleading verdict, supplied a repair, and checked real output. Those interventions are part of the story.

Use the [20-minute presenter card](docs/DEMO_BRIEF.md) for problem → solution → code → AI journey. The [submission packet](docs/SUBMISSION.md) contains the owner-confirmed two-paragraph introduction and access checklist. The repository remains private until the owner authorizes publication; nothing has been submitted.
