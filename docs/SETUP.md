# Setup

Use Node.js 24, the pnpm version pinned in `package.json`, a development Postgres database, a GitHub App and an authenticated Vercel CLI. Copy `.env.example` to `.env.local` and supply development credentials.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
vercel dev
```

Open `http://localhost:3000`. For UI-only development and `/demo`, `pnpm dev --webpack --hostname 127.0.0.1` does not require the Vercel live-session connection.

## GitHub and database

Register the GitHub App callback as `https://your-domain.example/api/github/callback` and Setup URL as `https://your-domain.example/api/github/setup`. Use the localhost callback in `.env.example` for local sign-in. Login redirects to that configured origin before setting its host-only OAuth nonce.

The GitHub App must be public to authorize other GitHub users; that is independent of this repository's visibility. **Connect your GitHub** / **Manage GitHub access** selects repositories for an unattached task.

`DATABASE_URL_DIRECT` must reach the same database as `DATABASE_URL` directly for `LISTEN/NOTIFY`. A transaction pool cannot serve that listener. Live sessions require the Vercel WebSocket runtime and Fluid compute.

Task invitations share one task and its working copy, not the inviter's other tasks or repository access. Listing and attaching repositories use the current user's GitHub authorization. Fresh clones receive a short-lived repository-scoped installation token; resuming an existing workspace does not request clone credentials. GitHub user tokens never enter the Sandbox or public task responses.

## Models and subscriptions

Vercel AI Gateway uses Vercel OIDC. `.env.example` documents the coding and planning model overrides. The bounded catalog in `src/lib/agents/coding-models.ts` determines available model/effort combinations. There is no automatic paid fallback, quota purchase or whole-turn replay.

Claude subscription access uses the server-only `HIVE_CLAUDE_OAUTH_TOKEN`. Managed Codex enrollment uses `HIVE_CODEX_AUTH_SECRET` and `scripts/bind-codex-auth.ts`; its header lists the explicit task, owner, repository and external private auth-file arguments. That operator command creates the platform account envelope and refuses an existing enrollment. It is not a browser credential-upload path. Never put login seeds inside this repository or copy an already managed seed into another refresh owner.

## Task tools and optional memory

Set `HIVE_INVITE_SECRET` and the canonical `GITHUB_APP_CALLBACK_URL` for task-scoped agent tools. The remote Sandbox must reach that callback origin; localhost is insufficient. Rotating the signing secret invalidates existing invitations. Runs receive a short-lived capability, not host database credentials or provider keys.

`MEM0_API_KEY` stays on the Hive server. It enables bounded automatic recall before a fresh coding turn. Recall uses the selected input, skips oversized or obviously sensitive queries, and proceeds without memory on timeout or error. Tool steps and human-only discussion do not trigger another automatic lookup.

Automatic recall and memory tools share a GitHub installation/repository scope. `remember_memory` selects one saved human contribution with authorship and source IDs. It does not upload the whole transcript or claim success for a pending write. Memory outages leave coding available.

See [architecture](DEVELOPMENT.md) for execution/data boundaries and [testing](TESTING.md) for local verification.
