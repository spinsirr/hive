# Hive

Hive is a multiplayer coding agent: two or more teammates share one agent conversation, one task, and one execution workspace. Every human contribution is attributed; comments can stay human discussion or be explicitly promoted into instructions that steer Hive.

**Live app:** [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/)

## The problem

Coding agents are still mostly single-player. One person owns the prompt, context, and running workspace; everyone else sees the result later in Slack, screenshots, or a pull request. By then, important intent has already been flattened or lost.

Hive moves collaboration into the agent session itself. Teammates can see the same transcript and workspace, speak directly to each other, annotate a specific statement, and deliberately steer the same agent without racing to replace its prompt.

## The product model

- A **team** is long-lived and owns GitHub repository access. New members need a valid task invitation; joining grants access to the team's authorized repository pool, not just the invited task's repository.
- A **task session** exists for one intended outcome. It has one shared transcript and at most one attached repository; seven-day signed links admit teammates explicitly.
- A session can begin without code. Hive first helps the team clarify intent; a repository can be attached later.
- A **message annotation** is discussion-only until a teammate promotes it to a **steer**.
- Typing `@` suggests actual session teammates. A leading teammate mention stays human discussion; choosing a suggestion does not send the message.
- A steer created during an active run enters an attributed, ordered queue and waits for a safe boundary.
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
- Hive can clone, edit, test, and expose a diff. Explicit branch push and PR creation are now in the [completion plan](docs/GOAL.md), but are not implemented yet.
- Repository access uses the GitHub App directly. The Vercel Connect experiment was removed because its current install flow is intended for connector developers, not this product's end-user onboarding.
- Production history lives in a durable Neon Free database provisioned through Vercel Marketplace. The previous temporary database is retained only for the short rollback window after migration.

## Local development

```bash
pnpm install
cp .env.example .env.local
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

The current suite covers invitation-only admission, signed invitation expiry and scope, local OAuth return paths, the multiplayer state machine, attributed prompts, safe-boundary queue execution and recovery, completed-session immutability, nonempty-diff approval, persistent sandbox selection, failure checkpoints, IME-safe submission, teammate autocomplete, retry deduplication, and draft recovery. Two real GitHub accounts have joined the production task; attribution, automatic message queuing, and retained transcript/queue after refresh were observed. A real accessibility change was recovered after earlier failed turns and verified through Runs, Files, and Diff, with the sandbox revision's 27 tests, TypeScript, and diff check passing. Annotation promotion and full two-account recovery remain unverified, and longer model runs have returned 429. Deterministic tests and local fixtures do not replace those production checks; see the evidence log below.

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
