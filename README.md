# Hive

**Agentic peer programming for small teams.**

Hive gives teammates one shared coding agent and workspace. One person starts a task; others join while work is in progress, ask questions, contribute context and review changes. The agent can ask the team for input and continue the task with their answer.

[Try the demo](https://hive-roan-mu.vercel.app/demo) · [Live application](https://hive-roan-mu.vercel.app/) · [Setup](docs/SETUP.md) · [Architecture](docs/DEVELOPMENT.md) · [Testing](docs/TESTING.md)

## Shared task flow

1. **Start a task.** Describe the outcome. Attach an authorized GitHub repository when ready to work on code, and invite a teammate using the task's invitation link.
2. **Discuss the work.** Normal messages address Hive. Leading teammate mentions and ordinary Thread replies remain human discussion.
3. **Direct the next change.** Steer a reply or Thread explicitly. Submitted input queues during a run and continues once after successful completion; errors and restored history pause continuation. Closing every viewer delays continuation until reconnect.
4. **Review evidence.** Inspect Files, Diff and original command output in Runs. Resolve a requested review against the actual current revision, or continue discussing the change.

A Thread steer freezes the selected replies; later discussion cannot silently change its instructions. Structured questions accept one attributed answer from the designated teammate. Review verification is separate from navigation and conversation closure. A checkpoint restores files and native context together while retaining discussion and queued input.

The public demo uses local sample state and simulated agent output. It requires no sign-in, calls no model and changes no repository.

## Boundaries and architecture

A task has one conversation, at most one repository and one mutating run at a time. Hive stops at inspectable changes and human review; it does not push generated code, create PRs, merge or deploy it. Files supports inspection and annotation rather than simultaneous human editing.

| Component                           | Responsibility                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Next.js and shared React components | Task UI, authenticated routes, production/demo interaction                      |
| GitHub OAuth and App                | Identity, user-authorized repository discovery, scoped clone credentials        |
| Neon Postgres                       | History, membership, input queue, execution grants and private recovery records |
| AI SDK Harness and Vercel Sandbox   | Coding tools, isolated working copy and native Codex/Claude history             |
| WebSockets, Streamdown and Monaco   | Live state, incremental replies and code inspection                             |

Task invitations do not share the inviter's other tasks or repository access. Public responses exclude native recovery payloads. Execution is request-bound; browser reconnect and manual lost-run recovery are not durable job orchestration. See [module and runtime boundaries](docs/DEVELOPMENT.md).

## Run locally

Use Node.js 24, the pinned pnpm version, an authenticated Vercel CLI, development Postgres and a GitHub App. Configure `.env.local` from `.env.example` using [the setup guide](docs/SETUP.md).

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
vercel dev
```

## Contributing and verification

```sh
pnpm check
pnpm build --webpack
```

[Code quality](docs/CODE_QUALITY.md) covers ESLint, Prettier, editor settings and commit hooks. [Testing](docs/TESTING.md) documents disposable Postgres, the full release gate and native runtime fixtures. [GitHub Actions](.github/workflows/ci.yml) checks each PR; [production acceptance](docs/RELEASE_ACCEPTANCE.md) separately requires real accounts and model interactions.

I designed Hive's module boundaries and overall framework, working with AI on alternatives, implementation and regression tests. Product and architecture decisions included one task per session, late repository attachment, explicit steering and keeping review separate from conversation closure. Historical investigations and release evidence remain in Git history and PRs.
