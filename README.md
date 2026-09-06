# Hive

One coding agent your whole team can work with.

Hive is a multiplayer coding agent: two or more teammates share one agent conversation, one task, and one execution workspace. Every human contribution is attributed; comments can stay human discussion or be explicitly promoted into instructions that steer Hive.

**Live app:** [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/)

## Try the app

Open the live app with a GitHub account already admitted to Hive, or open a teammate's **Invite** link to join. New accounts cannot join from the homepage alone. Reviewers will need an invitation; making the code repository public does not remove this sign-in boundary.

Create a task, invite a teammate, and start a conversation. Attach one authorized repository when ready to work on code. While Hive runs, new agent-directed messages queue; annotations stay discussion until explicitly promoted. At the end of the run, apply the next steer and review the actual Runs, Files, and Diff.

The [submission packet](docs/SUBMISSION.md) links the overview, summary, and outstanding access checks. Full two-account rehearsal is still pending; the verification section below distinguishes implemented behavior from observed results.

## The problem

The problem we started with: one person owns the prompt, context, and running workspace; everyone else sees the result later in Slack, screenshots, or a pull request. By then, important intent has already been flattened or lost.

Hive moves collaboration into the agent session itself. Teammates can see the same transcript and workspace, speak directly to each other, annotate a specific statement, and deliberately steer the same agent without racing to replace its prompt.

## The product model

- A **team** is long-lived and owns GitHub repository access. New members need a valid task invitation; joining grants access to the team's authorized repository pool, not just the invited task's repository.
- A **task session** exists for one intended outcome. It has one shared transcript and at most one attached repository; seven-day signed links admit teammates explicitly.
- A session can begin without code. Hive first helps the team clarify intent; a repository can be attached later.
- A **message annotation** is discussion-only until a teammate promotes it to a **steer**.
- Typing `@` suggests actual session teammates. A leading teammate mention stays human discussion; choosing a suggestion does not send the message.
- New agent-directed messages and promoted steers created during an active run enter an attributed, ordered queue and wait for a safe boundary.
- A safe boundary is the end of the current execution, including a failed attempt. Teammates explicitly apply the next steer from the conversation; later directions do not jump the existing queue.
- Completing a task makes the session read-only; teammates can reopen it if the work genuinely continues.
- Only a nonempty diff from a successful run, with no pending steer, can be approved. Approval records the team's review; it does not publish code.

The canonical vocabulary is recorded in [`CONTEXT.md`](CONTEXT.md).

## What is real

```text
GitHub OAuth → verified identity → invitation-only team admission → database login session
signed invite → explicit task-session membership
Postgres → transcript, presence, annotations, queue, lifecycle, and run state
GitHub App → team-authorized repository pool
task session → one selected repository
short-lived installation token → private clone in Vercel Sandbox
AI SDK Harness + Codex → inspect, edit, and run commands
workspace evidence → changed files, command output, and real git diff
```

- Next.js route handlers and server actions own all mutations.
- GitHub identity alone cannot create a Hive account. The login boundary admits existing members, the verified GitHub App owner, or a valid seven-day invitation to an existing task; account/session writes happen only after admission. Task access still requires explicit task membership.
- Postgres row locks serialize simultaneous teammate input.
- The same locked state transition grants the right to start a run; matching request timestamps do not grant execution.
- Messages and annotations carry a client submission ID. Retrying an unconfirmed submission reuses that ID; the locked transition does not duplicate an already accepted message or start another run. Acknowledgement means the contribution was saved, not that the agent succeeded.
- Unsent drafts survive refresh within the current browser tab, isolated by task and member. Failed delivery keeps the draft for explicit retry; background synchronization can confirm an accepted contribution, but never automatically resends it. If browser storage is unavailable, drafts remain in memory only.
- Browser snapshots never expose the opaque Codex resume checkpoint.
- Authenticated WebSockets carry shared snapshots and incremental agent replies. Postgres `LISTEN/NOTIFY` reaches viewers on different function instances; the listener uses the direct endpoint of the same Neon database, not its transaction pool.
- Public agent text is checkpointed in 250 ms batches with a stable reply ID and monotonic sequence. Reconnect subscribes before reading a fresh snapshot; it never starts another run. Tool output stays in Runs and reasoning never enters the chat. Streamdown renders Markdown as the text arrives.
- Each repository-backed task maps to a persistent named Vercel Sandbox and Codex session; Neon remains the canonical team history if compute disappears.
- GitHub App credentials stay server-side. Sandbox receives a fresh installation token limited to the selected repository.
- AI Gateway uses Vercel OIDC in production. `openai/gpt-5-mini` is the low-cost default for both planning and coding turns and can be overridden.
- The interface renders only real changed files, commands, and diffs returned by the runner—there are no hardcoded execution artifacts.

## Deliberate boundaries

- One team for the take-home; the membership model is explicit, but organization administration is out of scope.
- One repository and one mutating run per task session.
- Hive can clone, edit, test, and expose a diff. Branch push, PR creation, merging, and multi-team administration are outside the current [completion scope](docs/GOAL.md).
- Repository access uses the GitHub App directly. The Vercel Connect experiment was removed because its current install flow is intended for connector developers, not this product's end-user onboarding.
- Production history lives in a durable Neon Free database provisioned through Vercel Marketplace. The previous temporary database is retained only for the short rollback window after migration.

## Local development

Prerequisites: Node.js with native TypeScript execution (the latest recorded checks used v25.2.1), pnpm 11.19.0, an authenticated Vercel CLI, a development Postgres database, and GitHub App credentials. Configure `.env.local` from `.env.example` before migration. Use development credentials; a local database connection is not proof that you are testing production.

```bash
pnpm install
pnpm db:migrate
vercel dev
```

Open [http://localhost:3000](http://localhost:3000), sign in as the GitHub App owner to bootstrap the team, create a task, and copy its **Invite** link to a teammate. The App must be public for other GitHub accounts to authorize it; this does not make the code repository public. Keep non-production deployments protected because older builds may not enforce the current admission policy.

Install the [Vercel CLI](https://vercel.com/docs/cli) before running `vercel dev`. The WebSocket upgrade requires the Vercel runtime; plain `pnpm dev` / `next dev` remains useful for UI development but does not provide live session connections. Production requires Fluid compute, which is enabled on the current Hive project. See [Vercel's WebSocket documentation](https://vercel.com/docs/functions/websockets).

For production-equivalent Gateway authentication, link the Vercel project and pull its environment:

```bash
pnpm exec vercel link
pnpm exec vercel env pull .env.local
```

Required server variables are documented in [`.env.example`](.env.example). Register the GitHub App with these URLs:

```text
Setup URL: https://your-domain.example/api/github/setup
Callback URL: https://your-domain.example/api/github/callback
```

Login always starts on the origin configured in `GITHUB_APP_CALLBACK_URL`. Deployment aliases redirect there before issuing the host-only OAuth nonce, so the GitHub callback can verify the same browser. For local sign-in, configure a local callback rather than the production URL.

## Verification

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm exec next build --webpack
```

The 98-test suite covers invitation-only admission, signed invitation expiry and scope, OAuth origin and return-path checks, the multiplayer state machine, attributed prompts, safe-boundary queue execution and recovery, completed-session immutability, nonempty-diff approval, persistent sandbox selection, failure checkpoints, IME-safe submission, teammate autocomplete, retry deduplication, draft recovery, and streaming/reconnect guards. `pnpm test` also runs seven controlled regressions through the real coding runner and task transition, checking that failed runs retain command and file evidence without presenting unknown exit codes as passing, plus a pre-repository runner regression that verifies the selected attributed steer reaches the model input.

Historical production checks admitted two real GitHub accounts and observed attribution, automatic message queuing, and retained transcript/queue after refresh. On September 6, a real accessible-label change survived a rate-limited run, then passed the sandbox revision's 92 tests, TypeScript, and diff check in one recorded command. Runs, the actual diff, colored read-only Files, and the transcript survived a same-account production reload. The sandbox revision does not include the seven newer runner regressions; those are local regression evidence, not part of that live run.

The September 6 two-account check verified discussion-only annotations, explicit queuing during a real run, safe-boundary gating, and a second member's ordinary message queuing behind an active steer. It exposed an attribution bug: Hive confused an annotation's author with its parent message's author. The run input now separates those identities from the promoter and the teammate applying the steer, with regression coverage. The original queued case passed its production retest at 07:09 UTC: the annotation author was correctly identified even though another teammate applied it, and both accounts saw the same result. The retained ordinary message was executed once, and the queue cleared.

Cross-account Complete → refresh → Reopen also passed. After a tab-scoped offline reload, the second account rejoined an ongoing check without resending it; both accounts retained the transcript and real workspace. A longer offline interval also verified automatic recovery without a page reload: one missed teammate message arrived once, an unsent draft remained, and the browser recorded a new live WebSocket handshake without starting agent work. The latest recorded command, started at 07:33 UTC, passed all 92 sandbox-revision tests, TypeScript, and the diff check. Public text has been observed before execution finishes, but individual character cadence has not been measured; the no-reload recovery check used a human message, not an interrupted model delta.

Longer model runs have returned 429; a later successful continuation does not establish that the rate limit is resolved. Runs contains only the latest turn's commands; subsequent text-only replies leave that view empty. Recheck the inspectable command before rehearsal instead of treating an earlier chat summary as current evidence. The [dated evidence log](docs/PRESENTATION_NOTES.md#evidence-log) records these limits; deterministic tests and local fixtures do not replace production checks.

`pnpm typecheck` generates Next.js route types before running TypeScript, so it also works in a freshly cloned workspace that has not run a build or development server.

An opt-in transport diagnostic runs two independent Postgres listeners and two localhost WebSocket connections, checks delivery, reconnect snapshots, and authorization rechecks:

```bash
node --env-file=.env.local scripts/check-live-transport.ts
```

It uses transient notifications and isolated in-memory task fixtures, not task-table writes or model calls. It does not replace a two-account production test.

## Key decisions

- **Agent conversation first.** This is not a chat room with a bot attached.
- **Annotate is not steer.** Humans need room to discuss before directing execution.
- **Attach code when intent is ready.** Repository selection is not a provisioning prerequisite.
- **One task per session.** The team is durable; a session is intentionally disposable and bounded.
- **Reuse the harness.** AI SDK Harness, Codex, and Vercel Sandbox are infrastructure; multiplayer control is the product.
- **Artifacts over summaries.** Workspace navigation exposes the verifiable diff, bounded changed-file snapshots, and the latest run's command output; repository setup stands on its own before a run. Each artifact is the workspace surface itself, without decorative cards or duplicated panel chrome.
- **Quiet failures.** Errors appear as compact system state while the human prompt and resumable checkpoint remain intact.
- **Delivery is not execution.** Preserve an unconfirmed draft without repeating accepted work. Retry identity is scoped to a task and author; an explicit task reset also clears the transcript used for deduplication.

## AI collaboration

AI helped compare product directions, generate interface alternatives, implement the full-stack vertical slice, diagnose infrastructure failures, and build regression coverage. Human judgment repeatedly changed the result: narrowing the product from a generic team workspace to a task-scoped multiplayer agent, separating annotation from steering, rejecting fake execution artifacts and verbose errors, choosing an existing harness, and correcting the assumption that a Codex session ID alone makes history durable.

The fuller demo narrative, decision log, evidence, and 20-minute presentation outline live in [`docs/PRESENTATION_NOTES.md`](docs/PRESENTATION_NOTES.md).
