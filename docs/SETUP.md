# Hive — Setup and optional integrations

Use Node.js with native TypeScript execution (recorded checks used v25.2.1), pnpm 11.19.0, an authenticated Vercel CLI, a development Postgres database, and a GitHub App. Configure `.env.local` from [`.env.example`](../.env.example) with development credentials before migrating.

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

**Locally verified; real Mem0 save/recall acceptance is pending.** In a coding run, Hive's native Codex MCP tools can read bounded, attributed task context and reply to an existing Thread as Hive. Replies are discussion: they do not start a run, drain the queue, approve work, or restore checkpoints. The bundled [collaboration skill](../src/lib/codex-bridge/hive-collaboration/SKILL.md) explains those boundaries and the Sandbox environment without replacing native history.

Set `MEM0_API_KEY` on the **Hive server only** to enable automatic recall. The existing `HarnessAgent.prepareCall` hook searches once before a fresh coding turn, using the selected message/reply, or the task title for a whole-thread steer. It does not upload the expanded team prompt. Queries longer than 1,000 characters or matching the existing obvious-secret/code-fence guard are skipped. Up to three scoped memories are added as untrusted user-context data with bounded author/source fields; the current task remains last and takes precedence. Empty results, errors and a two-second deadline leave the original prompt unchanged, with no retries. Tool steps, suspended-turn continuations, opening a task and human-only discussion do not trigger another automatic lookup.

The optional MCP tools additionally require `HIVE_INVITE_SECRET` and the canonical `GITHUB_APP_CALLBACK_URL`. The Sandbox must be able to reach that origin; localhost configuration is not reachable from a remote Sandbox. Each run receives a five-minute task/member/run-scoped capability, never the Mem0 key. Calls recheck current membership and the active run; code artifacts and private native recovery data are excluded from tool-context SQL. Host-side automatic recall does not require this callback capability and does not mint or rotate invitation keys.

Both automatic recall and the optional `search_memory` tool use the same **GitHub installation + repository** scope, not the whole organization. The tool remains available for a different specific topic or an explicitly requested search, not redundant per-step lookup. On an explicit human request, `remember_memory` selects one saved human message/reply by ID and stores its short text verbatim, with author and source IDs, using Mem0's `infer: false`. Consent is instructed by the skill, not a new approval UI; server-side checks constrain the source and reject obvious secrets/code fences but are not a comprehensive secret detector. No automatic transcript ingestion, background memory polling, blind write retry, or claimed save on a pending result. A missing key or memory outage does not remove the coding tools. [Mem0 add API](https://docs.mem0.ai/api-reference/memory/add-memories).
