# Testing

Use Node.js 24 and the pinned pnpm version. Application unit tests live beside their modules in `src/**/*.test.ts`; the unit command discovers nested tests recursively. `tests/ui/` owns component and hook interactions, `tests/agents/` controlled agent/provider boundaries, and `tests/integration/` route and database checks. `tests/native/` is the optional real-executable suite. `scripts/` contains build preparation, the release coordinator and operator enrollment.

## Default checks

```sh
pnpm check
pnpm build --webpack
```

`pnpm check` runs formatting, zero-warning ESLint, TypeScript, shared production/demo UI ownership and the default regression suite. `package.json` is the list of commands; `.github/workflows/ci.yml` defines the remote jobs. The commit hook checks staged lint/format, then types and the full default suite.

The default suite covers actual React interactions and controlled route/native-process boundaries: attribution, queue ordering, frozen input, edits, IME, focus, scroll, streaming, file safety, recovery, MCP and memory calls. OAuth-origin checks invoke the real routes without a running server; transport checks use loopback HTTP. These fixtures do not contact real accounts or models.

## Database and complete release check

Use disposable loopback Postgres with permission to create databases. Do not point this at production or a tunnel to it. CI uses Postgres 17.

```sh
pnpm test:release --plan
HIVE_QA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres pnpm test:release
```

The release coordinator runs all eight stages: format, lint, shared UI ownership, types, regression, integration, peer-store and production build. It writes per-stage logs and a revision/source-fingerprint report to a new temporary directory. A local pass does not mark production acceptance as passed.

For just the database checks:

```sh
export HIVE_AUTH_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
export HIVE_ONBOARDING_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export HIVE_EGRESS_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export HIVE_RECOVERY_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export HIVE_PEER_TEST_DATABASE_URL="$HIVE_AUTH_TEST_DATABASE_URL"
export DATABASE_URL_DIRECT="$HIVE_AUTH_TEST_DATABASE_URL"
pnpm test:integration
pnpm test:peer-store
```

These exercise authorization, onboarding, private/public data projections, exactly-once execution, delayed provider updates, recovery and cross-instance presence. Fixture suites create, migrate and drop only their own unique databases; live transport uses transient notifications. The egress check deliberately observes 31 seconds of idle connections.

## Native runtime checks

`tests/native/` contains optional tests of real pinned Codex/Claude executables against loopback model/tool fixtures. They cover behavior that the default process doubles cannot establish: native streaming, HTTP transport, refresh refusal, history boundaries, questions, MCP and child interruption. They require separate SDK installations, not personal login credentials, and are not part of CI.

Use an isolated install containing `@openai/codex@0.149.1` and `@openai/codex-sdk@0.149.1` for the Codex checks. The Claude check asserts Agent SDK `0.3.245` and CLI `2.1.245`. These are the fixture's pinned compatibility versions, not recommendations for the latest release.

```sh
node tests/native/check-codex-process.mjs /absolute/path/to/codex-fixture
node tests/native/check-native-claude.mjs /absolute/path/to/claude-fixture
```

The other scripts in that directory take the same isolated Codex install argument. Run them when changing the native bridge or upgrading its bundled runtime. A real executable with simulated inference still does not establish real model behavior.

## Shared fixtures

Reusable fixture support lives in `tests/helpers/`.

- `test-modules.mjs`: register aliases, Next entry points and TSX loading before dynamically importing application modules. Scenario-specific mocks stay in the test and forward unmatched loads/resolutions.
- `test-dom.mjs`: create browser globals before importing Testing Library; run component cleanup before closing the fixture, which restores previous globals.
- `test-database.mjs`: call `start()` and `close()` in `try/finally`. It owns a unique local database and pool/socket teardown; it never force-drops other connections.
- Temporary Git fixtures clear inherited `GIT_*` repository locations and global configuration, then verify their actual Git directory. Commit-hook environments must not redirect fixture writes to the working repository.

Keep new regressions in the appropriate suite and wire their command into `package.json`. One-off investigations and dated results belong in the issue/PR or private run evidence, not another permanent test script or repository report. Use [production acceptance](RELEASE_ACCEPTANCE.md) for real-account and model verification.
