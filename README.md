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

## What Hive is — and is not

Hive focuses on one shared coding task: one conversation, at most one attached repository, and one mutating agent run at a time. A person can start alone and invite teammates. Discussion, explicit steering and code review form the core workflow; approving a diff keeps the conversation open.

Hive is not a general team chat, a multi-agent orchestration system or a full collaborative IDE. It uses an existing coding runtime and provides the shared controls around it. PR creation, sandbox branch pushes, merging, deployment of generated changes and organization administration are outside this submission. Repository memory is an optional extension with its verification status below.

## Architecture

Hive owns shared task state, input ordering and review. The existing Codex harness owns coding execution inside Vercel Sandbox. Postgres preserves team history and private recovery records.

```mermaid
flowchart LR
    People["Teammates"] <--> UI["Shared conversation and review"]
    UI <--> Task["Hive task state and steering"]
    Task <--> DB[("Postgres")]
    Task -->|One run at a time| Runtime["Codex in Vercel Sandbox"]
    Runtime --> Gateway["AI Gateway"]
    Runtime -->|Files, diffs and command output| UI
    classDef people fill:#e8f1ff,stroke:#2563eb,color:#102a43
    classDef surface fill:#f3e8ff,stroke:#7c3aed,color:#2e1065
    classDef core fill:#e6f6ec,stroke:#24864b,color:#123b24
    classDef data fill:#e3f6f5,stroke:#0f766e,color:#123b3a
    classDef execution fill:#fff4cc,stroke:#b7791f,color:#422006
    class People people
    class UI surface
    class Task core
    class DB data
    class Runtime,Gateway execution
```

This is a responsibility diagram. Runtime output reaches the shared UI through Hive; teammates do not connect directly to the Sandbox.


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
- **Show honest failures.** Runs displays process exit codes and original output, not an inferred test verdict. It shows the latest turn, so a later text-only reply can correctly show no commands. Diff shows real old/new file line numbers; the captured diff is capped at 60 KB, changed-file previews at 12 files of 20 KB each, and each command's output at 20 KB, with a visible truncation notice.
- **A lost run is recoverable without losing the team's work.** Execution is bound to one request of at most five minutes. If a run has not reported for six minutes, any member can mark it as lost: the discussion, partial reply and queued steers stay, nothing reruns, and the task becomes steerable again. This is a manual, disclosed recovery, not automatic resumption after hard worker termination.
- **Reset is deliberate.** Resetting a task clears the shared conversation for everyone and cannot be undone, so it requires a confirmation and an idle task (no active run, applied steer or queued input). Conversation messages carry timestamps shown in each viewer's local time; a message may hold up to 8,000 characters, Thread replies 4,000 and code annotations 500.
- **Bound the submission.** No PR creation, sandbox branch push, issue triage, uploads, or multi-team administration. Vercel Workflow remains deferred. The owner's subsequent, narrow request for repository memory is described below; one bounded live round on September 10 (UTC) saved a selected reply and recalled it in another task on the same repository, while the source-task citation defect, live cross-repository isolation and Gateway rate limits remain open. Browser reconnection and caught-failure checkpoints do not guarantee automatic recovery after hard worker termination.

Task membership and GitHub repository access are separate. An invitation shares only that task's conversation and attached working copy, not the inviter's other tasks or repository pool. Repository listing and attachment both query GitHub using the current user's access token, including when several users share an App installation. The user's encrypted, HttpOnly GitHub cookie is bound to one Hive login, expires within eight hours (or sooner if GitHub specifies), and is cleared on logout. Missing, expired or revoked authorization asks for **Reconnect GitHub**; it never falls back to App-wide access. The existing OAuth client secret derives a purpose-specific encryption key; invitation signing is unchanged and no new secret or database migration is required. [GitHub's user-scoped repository API](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token).

Installation tokens remain short-lived and scoped to the selected clone. The GitHub user token is never sent to the Sandbox, placed in a task transcript, or included in a repository API response. Keep non-production deployments protected.

## Run locally

Use Node.js with native TypeScript support, pnpm, a development Postgres database and a GitHub App. Configure `.env.local` from [`.env.example`](.env.example), then run:

```bash
pnpm install
pnpm db:migrate
vercel dev
```

See [Setup and optional integrations](docs/SETUP.md) for verified runtime versions, GitHub callbacks, live connections, model access and the optional memory configuration. Memory's live save/recall passed one bounded round on September 10 (UTC); its remaining boundaries are listed in the [memory tradeoff](docs/MEMORY_TRADEOFF.md).

## Verification

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build --webpack
```

GitHub Actions runs these checks on every pull request and push to `main`, with a manual run option. The [CI workflow](.github/workflows/ci.yml) uses Node.js 24, the pnpm version pinned in `package.json`, cached dependencies and frozen lockfile installs. Lint/types, tests and the production build report separately; a newer commit cancels the previous run on that branch.

The test job also runs `pnpm test:integration` against disposable Postgres 17. This covers subscription authentication, onboarding, session egress, stalled-run recovery and cross-instance live transport. The first four suites each create, migrate and drop their own database; live transport uses transient notifications. No application secrets or paid services are required.

To run the integration checks locally, point all five variables at a disposable loopback Postgres server whose user can create databases:

```bash
export HIVE_AUTH_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
export HIVE_ONBOARDING_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export HIVE_EGRESS_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export HIVE_RECOVERY_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export DATABASE_URL_DIRECT="$HIVE_AUTH_TEST_DATABASE_URL"
pnpm test:integration
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

I designed Hive’s module boundaries and overall architecture, and worked with AI to brainstorm alternatives and implement the design. I owned the product and technical decisions, refining them as we tested the experience: one task per session, late repository attachment, explicit steering, inspectable execution artifacts, and persistence beyond a Sandbox session ID. AI supported implementation, diagnosis and regression testing.

Verification also changed the result. A command swallowed failed edits behind exit zero, and an AI-written regression queried a deliberately hidden button. The supervising AI reproduced the failures, corrected the misleading verdict, supplied a repair, and checked real output. Those interventions are part of the story.

Use the [20-minute presenter card](docs/DEMO_BRIEF.md) for problem → solution → code → AI journey. The [submission packet](docs/SUBMISSION.md) contains the owner-confirmed two-paragraph introduction and access checklist. The repository remains private until the owner authorizes publication; nothing has been submitted.

## Further reading

- [Product vocabulary](CONTEXT.md) — task, Thread, steer, workspace and checkpoint boundaries.
- [Decisions and development history](docs/PRESENTATION_NOTES.md) — design ownership, alternatives, AI collaboration and dated evidence.
- [Setup and integrations](docs/SETUP.md) — runtime requirements, authentication and optional memory.
- [Presenter card](docs/DEMO_BRIEF.md) — the focused 20-minute route.
