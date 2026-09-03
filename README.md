# Hive

Hive is a coding agent that a team owns together. Multiple teammates share the
same live conversation, workspace, and run state. Each person can prompt Hive,
annotate its work, talk directly to a teammate, and explicitly promote an
annotation into a steer for the shared agent.

**Live app:** [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/rooms/orbit-nav)

## Local development

Provision a Postgres database through the Vercel Marketplace Neon integration,
or provide another Postgres connection with the same environment variables:

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

To enable real Hive replies locally, link the app to its Vercel project and pull
the project environment. Vercel AI Gateway uses the generated OIDC token, so the
app does not need a personal Claude or OpenAI key:

```bash
pnpm exec vercel link
pnpm exec vercel env pull .env.local
```

Open [the local room](http://127.0.0.1:3000/rooms/orbit-nav), sign in with
GitHub, and copy its **Invite** URL to a teammate. The URL selects the shared
room; the signed server session determines who each person is. Messages,
presence, annotations, steering, and Hive's run state synchronize between both
clients.

## Current vertical slice

```text
GitHub user OAuth → revocable database session → attributed room member
room URL → one durable transcript and Codex workspace shared by its members
GitHub App installation → repository-scoped execution credential
short-lived installation token → private repo in persistent Vercel Sandbox
team prompt → Codex Harness turn → read/write/command → real git diff → shared room
annotation → explicit steer → resume the same Codex thread and workspace
```

## Current implementation boundary

- One team, one repository per room, and one shared mutating run.
- Any GitHub-authenticated teammate can join the shared room URL. Browser input
  never chooses or overrides message authorship.
- Human sessions are stored in Postgres behind random, hashed tokens and an
  HTTP-only, secure, SameSite cookie. Signing out revokes the database session.
- Room state and presence are persisted in Neon Postgres, with state transitions
  serialized in a transaction so simultaneous teammates cannot overwrite each
  other's input.
- Messages addressed to Hive route through Vercel AI Gateway. Direct teammate
  mentions remain human-to-human, while **Steer Hive** explicitly wakes the
  agent with the promoted annotation.
- Steers created while Hive is already running enter an attributed shared queue
  instead of interrupting the current step. Teammates can reorder or remove
  them, and the next item is consumed only at an explicit safe boundary.
- Hive uses AI SDK Harness's Codex adapter with `openai/gpt-5-mini` as the
  low-cost debugging default; `HIVE_CODEX_MODEL` can override it.
- Each room maps to one persistent named Vercel Sandbox and one Codex session.
  Hive checkpoints failed as well as successful turns, while Neon remains the
  canonical team transcript if compute disappears.
- Codex can inspect, edit, and execute commands against the repository. The
  resulting changed files, command output, and `git diff` are persisted into the
  same shared room.
- Repository connection uses a GitHub App installed on exactly one selected
  repository. GitHub user OAuth verifies who is allowed to bind that
  installation to Hive; the one-time user token is discarded immediately.
- Vercel Sandbox receives a fresh installation token limited to that repository
  and `contents:read`. Hive never stores a personal access token, and the
  installation token expires within one hour.
- Codex Harness resume checkpoints stay server-side. Room API responses include
  the public session ID and runtime but strip the opaque resume state.
- The deployed app is connected to Postgres and the shared multiplayer room is
  live. The current take-home database is temporary and must be replaced with a
  durable Vercel Marketplace Postgres integration before final submission.
- Production OIDC authentication to AI Gateway is verified after transferring
  Hive to the credited Vercel scope. A resumed live Codex thread executed a real
  repository command without adding a personal provider key.
- The previous Orbit preview, hardcoded diff, hardcoded test output, and fake PR
  number have been removed. The workspace only renders artifacts returned by a
  real sandbox run.
- GitHub write-back is intentionally not connected yet: Hive can clone, edit,
  and test in Sandbox, but cannot push a branch or open a pull request.

## GitHub App setup

Register a GitHub App with repository Contents read/write and Pull requests
read/write permissions, then configure its setup and OAuth callback URLs:

```text
https://your-domain.example/api/github/setup
https://your-domain.example/api/github/callback
```

The deployed server needs `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_CALLBACK_URL`. All credentials stay
server-side; none are exposed to the sandbox or browser.

## State-machine driver

The browser room is backed by a pure reducer. It can also be driven directly:

```bash
pnpm prototype:state
```

## Presentation record

The product narrative, decision log, AI collaboration notes, demo pacing, and
evidence are maintained in [`docs/PRESENTATION_NOTES.md`](docs/PRESENTATION_NOTES.md).
