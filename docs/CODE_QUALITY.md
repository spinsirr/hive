# Code quality

Use Node.js 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`check` runs the same static checks as CI, then the existing unit, component and controlled route/runtime regressions. Database integration and the production build are separate CI jobs; use `pnpm test:release` with a disposable loopback database for the full local pass described in [TESTING.md](TESTING.md).

## Commands

| Command                   | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `pnpm format`             | Format authored files across the repository.                    |
| `pnpm format:check`       | Fail on formatting drift; never write files in CI.              |
| `pnpm lint`               | Run ESLint across the repository, failing on any warning.       |
| `pnpm lint:fix`           | Apply available ESLint fixes, then report remaining errors.     |
| `pnpm typecheck`          | Generate Next route types and check TypeScript.                 |
| `pnpm test:design-system` | Enforce shared production/demo component ownership.             |
| `pnpm check`              | Run formatting, lint, types, UI ownership and regression tests. |

Prettier owns formatting. ESLint owns errors and maintainability rules; `eslint-config-prettier` disables competing style rules. The configuration keeps Next/React/Hooks checks, adds the JavaScript recommended rules, and enables typed checks on **all TypeScript**, including tests and scripts. Typed checks cover unhandled promises, async callbacks used as synchronous callbacks, awaiting non-promises, unnecessary assertions, exhaustive switches and type imports.

Two rule choices are deliberate: registering `node:test` tests does not require awaiting the runner-owned registration promise (promises inside the tests still do); unused object properties deliberately removed with rest destructuring are allowed. `void` marks deliberate fire-and-forget work, but does **not** handle rejection. Review the called function's error handling before using it.

Generated Next files, Monaco bundles, coverage and deployment output are excluded. Prettier additionally skips the package-manager lockfile and generated Drizzle metadata. Authored application code, test scripts, documentation and configuration remain in scope. Code inside JavaScript strings is not analyzed as executable code; see the runtime-asset finding in the review.

## Before committing

`pnpm install` installs Husky. Its pre-commit hook runs lint-staged (ESLint fixes and Prettier on staged files), then the full typecheck and regression suite. The staged-file patterns do not overlap, so two commands cannot concurrently rewrite the same file. The hook is not the only enforcement: GitHub Actions checks the whole repository, even if a local hook is bypassed.

EditorConfig establishes UTF-8, LF and two-space indentation. The committed VS Code/Cursor settings enable Prettier on save and explicit ESLint fixes; extensions are recommended, not installed automatically.

CI runs format/lint/types, database tests and a production build. The workflow does not change GitHub branch protection or prevent an administrator from bypassing checks; those settings are outside this local change.

## Structural review remains required

Lint passing does not prove that a state model or abstraction is good. Apply the [Thermo-Nuclear Code Quality Review skill](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md) to meaningful changes. In particular, avoid adding cases to the session reducer, duplicating action contracts, performing provider calls under row locks, or adding more responsibilities to the workspace component.

The [September 13 review](CODE_QUALITY_REVIEW.md) records current hotspots. It intentionally does not suppress them behind a generated baseline or turn existing structural problems into accepted thresholds. To reproduce its structural scan:

```sh
pnpm exec eslint src --rule 'complexity:[warn,20]' --rule 'max-lines:[warn,{max:1000,skipBlankLines:true,skipComments:true}]'
```

These diagnostic rules report existing debt; they are not the zero-warning lint gate. Complexity includes optional chaining, default parameters and JSX branches, so inspect the implementation before treating a number as a defect. A file crossing 1,000 lines through new responsibilities requires decomposition or a concrete structural justification. The repository-wide formatter expansion in this change exposes pre-existing compressed code; it does not claim to resolve it.

When an exception is necessary, keep it local and explain the invariant. For example, workspace path validation intentionally matches ASCII control characters, so the `no-control-regex` exception sits at that expression. Do not disable a rule for an entire directory to make a check pass.
