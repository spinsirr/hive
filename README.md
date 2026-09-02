# Hive

Hive is a coding agent that a team owns together. Multiple teammates share the
same live conversation, workspace, and run state. Each person can prompt Hive,
annotate its work, talk directly to a teammate, and explicitly promote an
annotation into a steer for the shared agent.

**Live demo:** [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/?as=spencer)

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

Open the same room as two demo participants:

- [Spencer](http://127.0.0.1:3000/?as=spencer)
- [Maya](http://127.0.0.1:3000/?as=maya)

Messages, presence, annotations, steering, and Hive's run state synchronize
between both clients.

## Current vertical slice

```text
connect public GitHub repo → persistent Vercel Sandbox workspace
team prompt → AI SDK tool loop → read/write/command → real git diff → shared room
annotation → explicit steer → resume the same coding workspace
```

## Current implementation boundary

- One team, one repository, one shared mutating run.
- Two demo members and one shared Hive identity.
- Room state and presence are persisted in Neon Postgres, with state transitions
  serialized in a transaction so simultaneous teammates cannot overwrite each
  other's input.
- Messages addressed to Hive route through Vercel AI Gateway. Direct teammate
  mentions remain human-to-human, while **Steer Hive** explicitly wakes the
  agent with the promoted annotation.
- Steers created while Hive is already running enter an attributed shared queue
  instead of interrupting the current step. Teammates can reorder or remove
  them, and the next item is consumed only at an explicit safe boundary.
- `anthropic/claude-haiku-4.5` is the cost-conscious default model and can be
  replaced with `HIVE_MODEL`.
- Hive uses AI SDK's `ToolLoopAgent` with four Vercel Sandbox tools: list files,
  read file, write file, and run command. The resulting changed files, command
  output, and `git diff` are persisted into the same shared room.
- Public GitHub repositories can be connected by URL today. Private repository
  access through short-lived GitHub App installation tokens is the next layer.
- The deployed app is connected to Postgres and the shared multiplayer room is
  live. The current take-home database is temporary and must be replaced with a
  durable Vercel Marketplace Postgres integration before final submission.
- Production OIDC authentication to AI Gateway is verified. The personal Vercel
  scope currently returns `customer_verification_required`; adding billing
  verification (or moving the project to the credited scope) unlocks model
  responses without adding a personal provider key.
- The previous Orbit preview, hardcoded diff, hardcoded test output, and fake PR
  number have been removed. The workspace only renders artifacts returned by a
  real sandbox run.
- GitHub write-back is intentionally not connected yet: Hive can clone, edit,
  and test in Sandbox, but cannot push a branch or open a pull request.

## State-machine driver

The browser room is backed by a pure reducer. It can also be driven directly:

```bash
pnpm prototype:state
```

## Presentation record

The product narrative, decision log, AI collaboration notes, demo pacing, and
evidence are maintained in [`docs/PRESENTATION_NOTES.md`](docs/PRESENTATION_NOTES.md).
