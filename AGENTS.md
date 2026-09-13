# Project workflow

- Read [the code quality guide](docs/CODE_QUALITY.md) before changing quality tooling. Run `pnpm check` for code changes; do not hide failures with blanket ignores or regenerated lint baselines. The [full repository review](docs/CODE_QUALITY_REVIEW.md) lists existing structural debt, not approved patterns to copy.

- The `ship` skill is disabled for Hive. Do not load or invoke any `ship` skill, directly or through another workflow.
- Do not start the automatic external-review pipeline associated with `ship`. Follow the user's requested release scope and the repository's existing GitHub/Vercel workflow instead.
- When the user reports a bug, diagnose, fix and verify it directly rather than stopping at an explanation or asking whether to fix it. Preserve existing work and safety checks; this does not authorize unrelated destructive actions or broaden release scope.
- Feature acceptance requires real production interactions and real agent runs when relevant. Demo, mocks and passing automated checks are regression support, not a substitute for production verification. Use isolated test tasks and preserve users' existing work; report any unverified cases explicitly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
