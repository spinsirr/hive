# Hive — Testing and verification

Commands, test boundaries and dated live evidence. For current release gaps, see [release status](ROADMAP.md).

For a fresh end-to-end release pass, start with the [ordered production acceptance script](RELEASE_ACCEPTANCE.md). `pnpm test:release --plan` lists the existing local checks; `HIVE_QA_DATABASE_URL=postgres://localhost/postgres pnpm test:release` runs them with per-stage logs and a revision-stamped report. Use an isolated worktree without `.env` files and a disposable loopback Postgres role that can create databases. The runner refuses remote databases, does not pass application credentials to child processes, and never marks production acceptance as passed. It includes `test:peer-store` as well as `test:integration`, matching the full CI boundary.


```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build --webpack
```

GitHub Actions runs these checks on every pull request and push to `main`, with a manual run option. The [CI workflow](../.github/workflows/ci.yml) uses Node.js 24, the pnpm version pinned in `package.json`, cached dependencies and frozen lockfile installs. Lint/types, tests and the production build report separately; a newer commit cancels the previous run on that branch.

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

### UX regression purposes

- `pnpm test:ux-regressions`: a task without a repository uses the existing MCP question schema, shows one inline card without an extra empty reply, accepts the designated member's answer once, and starts one continuation. The recovery hook checks before the write-retry lease expires, survives a transport timeout, and stops after confirmation without repeating a restore.
- `node --experimental-test-module-mocks scripts/check-workspace-restore.mjs`: the real route releases the composer only after provider metadata proves a new VM came from the selected checkpoint. A write-retry delay must not delay that read-only confirmation.
- `node --test src/lib/conversation-timeline.test.ts src/lib/hive-prompt.test.ts`: operation receipts remain in stored agent context but do not masquerade as user/assistant chat; a receipt cannot replace the latest human request. Existing discussion attached to a receipt is preserved.
- `node --experimental-test-module-mocks scripts/check-planning-subscription.mjs`: both native engines receive the same scoped collaboration endpoint before repository attachment, with settings validated by the installed Harness SDK.

These checks do not establish real model brevity or production recovery latency. Release acceptance must additionally run a no-repository question/answer with real accounts, a repository-backed question without skill/workflow narration, and a real checkpoint restore on the deployed revision. Verify that editing becomes available, files match the checkpoint, and no duplicate question, Thread, operation bubble or automatic agent run appears.

`scripts/check-memory-recall.mjs` uses the installed Harness SDK with controlled native-runtime and Mem0 HTTP boundaries. It verifies per-turn recall, multiple tool steps, fresh-process suspended continuation without another lookup, attribution, scope filtering, bounded provenance, unsafe-query skips and a stalled request that cannot block coding. The runner regression separately verifies that this hook is wired into coding execution. These are not live Mem0 or model-behavior claims.

For onboarding and authorization, set `HIVE_ONBOARDING_TEST_DATABASE_URL` to a **local loopback** Postgres server with database-creation permission, then run `pnpm test:onboarding`. It creates and drops only its uniquely named fixture database. Actual OAuth routes, session persistence, task creation, task pages and protected APIs verify first signup, empty dashboard, task invitations, user-scoped GitHub listing/attachment, credential expiry and account isolation. GitHub HTTP is controlled; no real account, Neon database, Sandbox or model is contacted. This is not a substitute for a fresh-account production walkthrough.

For real Postgres/live-route egress regression coverage, set `HIVE_EGRESS_TEST_DATABASE_URL` to a **local loopback** Postgres server with a role that can create databases, then run `pnpm test:session-egress`. The check creates and removes its own uniquely named fixture database. It does not load `.env.local`, contact Neon, use real accounts, or call a model. It measures 31 seconds of idle connections, verifies typing and multi-tab presence without presence-table/task reads, and retains SQL-side exclusion of private recovery data. See the [September 8 incident](DEVELOPMENT.md#september-8--neon-egress-incident) for historical measurements and production availability limits.

That database check also covers the signed agent-tool route, bounded bodies, retry-safe replies, and revoked/stale-run access. For native integration, `node scripts/diagnostics/check-hive-tools.mjs /path/to/isolated/sdk-install` requires an isolated `@openai/codex-sdk@0.149.1` installation. It runs the real Codex process against loopback model and Mem0 fixtures, verifying skill loading, same-thread history, tool execution and cross-task recall—not real model behavior or Mem0 Cloud availability.

Presence follows authenticated WebSocket connections, not a periodic HTTP request or a stored `last_seen` value. Native ping/pong checks the browser connection every 20 seconds without SQL. Existing Postgres `NOTIFY` relays only member IDs and typing flags across instances; each active instance/task renews its small announcement every 30 seconds, without table writes or repeated reads on receipt. Normal disconnects publish a leave; an ungraceful instance loss expires after 90 seconds. This is reduced database traffic, not zero database traffic. The retired presence table is unused but retained; no destructive migration is required. See [connection-presence evidence](DEVELOPMENT.md#september-8--connection-owned-presence).

On September 8, the independent real-repository task completed `pnpm test && pnpm typecheck && git diff --check` with Exit 0. Its older Sandbox checkout passed **125 unit tests**, component regressions, TypeScript, and diff validation. Both real GitHub accounts inspected the two-file change and attributed response, then verified approval and the then-existing Complete → refresh → Reopen flow. Manual task completion was [removed on September 9](DEVELOPMENT.md#september-9--execution-completion-is-not-conversation-closure). Earlier checks separately verified queued Threads, excluded later replies, native incremental text, offline recovery, and paired restore with pending input.

The supervising AI operated both authenticated accounts and supplied a tested repair after earlier agent failures. This was not two independent human reviews or an autonomous first-pass success. Provider 429 risk remains; these checks do not prove hard-worker-crash or permanent-Sandbox-deletion recovery.

The [dated evidence log](DEVELOPMENT.md#evidence-log) records successes, failures, versions, and test limitations. Historical checks do not substitute for fresh-account and final-release acceptance.
