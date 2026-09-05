# Hive — Presentation Notes

This is the source of truth for the take-home story. Update it when a product decision changes or a claim gains evidence.

## Submission checklist

Send all four at least 24 hours before the presentation:

- Public GitHub repository with readable commit history.
- Live deployed URL.
- README covering the problem, decisions, and AI collaboration.
- One-to-two paragraph summary blurb.

The presentation is 90 minutes; the product demo is about 20 minutes in this order: problem, solution, code, AI journey.

Current app: [hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/)

## Summary blurb

Hive is a multiplayer coding agent for small software teams. Instead of one person privately prompting an agent and handing the result to teammates later, everyone shares the same task-scoped conversation and execution workspace. Teammates can talk directly to one another, annotate a specific message, or deliberately promote an annotation into a steer for Hive.

I built the smallest full-stack version that proves that interaction. GitHub OAuth provides real authorship, signed invites control session membership, Postgres persists and serializes shared state, a GitHub App supplies team repository access, and AI SDK Harness runs Codex inside a persistent Vercel Sandbox. The product exposes real files, commands, and diffs for the team to review together.

## Problem

Coding agents are still primarily single-player. One person owns the prompt, transcript, and workspace; teammates enter after the agent has already acted. The team copies context across private agent sessions, chat tools, screenshots, and pull requests, losing both intent and clear authorship.

The missing primitive is not another team chat. It is a shared agent session where several humans can see the same work, discuss it in context, and control one agent without racing to overwrite one another.

## Solution

Hive makes the agent conversation the primary product surface:

- Every normal message addresses Hive; an explicit `@teammate` mention remains human discussion.
- Every human message has server-authoritative authorship.
- A teammate can annotate a particular message without waking Hive.
- Promoting an annotation to **Steer Hive** makes the transition from discussion to execution visible.
- Steers created during a run enter an attributed, ordered queue and wait for a safe boundary.
- Everyone sees the same transcript, presence, repository, run state, files, command output, and diff.

## Domain model

- **Team:** long-lived people and shared GitHub repository access.
- **Task Session:** one intended outcome, one shared transcript, and at most one repository.
- **Repository Access:** the team-authorized GitHub pool.
- **Attached Repository:** selected at any time after a task begins and immutable within that session.
- **Annotation:** discussion attached to a teammate message.
- **Steer:** discussion explicitly promoted into agent direction.
- **Run:** one execution turn against the attached repository.
- **Workspace:** evidence of what the agent actually did.

This correction matters: the team is the durable collaboration space; a session is not a channel or project. Its lifecycle is exactly one task.

## Taste and scope decisions

| Decision | Why it matters | Rejected alternative |
| --- | --- | --- |
| Make the agent conversation primary | Collaboration happens before and during execution, not beside it. | A team chat with a tagged bot. |
| One task per session | Gives the transcript, repository, and run state a clear lifecycle. | A long-lived room that accumulates unrelated work. |
| Allow conversation before repository attachment | Intent can be clarified before code access is needed. | Requiring a repo during session provisioning. |
| Separate annotate from steer | Humans can discuss without accidentally redirecting the agent. | Treating every comment as a prompt. |
| Queue concurrent steering | Multiplayer input stays visible, attributed, and deterministic. | Last-write-wins prompts or silent instruction merging. |
| One repository per task | Keeps credentials, filesystem scope, and review evidence legible. | Ambient access to every team repository. |
| GitHub App for team access, OAuth for identity | Repository authority and human identity have different lifecycles. | Personal access tokens or browser-supplied identity. |
| Reuse AI SDK Harness + Codex + Sandbox | The differentiator is multiplayer control, not rebuilding an agent runtime. | A custom harness and container platform. |
| Show artifacts, not a generic overview | Diff, changed files, and run history each have a clear object and can be verified. | A dashboard tab that mixes repository metadata, status, and summary counts. |
| Name the human need, not the implementation | Runs is an audit trail for teammates: command, outcome, duration, and expandable output. | Calling a read-only log “Terminal” and implying that humans should operate it. |
| Neon is canonical history | Native Codex history can disappear with compute; team intent cannot. | Treating sandbox files as the product database. |
| Quiet error state | A failure should not become a theatrical agent apology. | Large error bubbles that repeat internal details. |
| Ordinary frontend demo task | A second-level menu exposes intent ambiguity without domain setup. | A deployment workflow that distracts from collaboration. |
| Remove Vercel Connect experiment | The available install flow is developer-dashboard oriented; direct GitHub App onboarding fits users today. | Shipping a connector path users cannot complete. |

## Demo sequence (20 minutes)

### 0–3 min — Problem

Explain how a coding task currently begins in one person’s private agent context and becomes collaborative only after work is produced. Emphasize lost intent, delayed review, and unclear authorship.

### 3–10 min — Product

1. Create “Polish the mobile navigation” from the task list.
2. Start talking to Hive before attaching a repository; agree on expected behavior.
3. Attach `spinsirr/hive` from the team’s authorized repository pool.
4. Open the signed invite in a second authenticated browser.
5. Send `@Spencer should the parent remain expanded?`; point out that Hive does not answer.
6. Add “Keep the parent expanded, highlight only the active child” as an annotation.
7. Promote it to **Steer Hive** while a run is active; show author and queue position.
8. Review the same real commands, changed files, and git diff from both browsers.
9. Complete the task and show that the transcript becomes read-only.

### 10–15 min — Code

- [`src/lib/task-session.ts`](../src/lib/task-session.ts): pure multiplayer state machine and wake-up boundaries.
- [`src/lib/task-session-store.ts`](../src/lib/task-session-store.ts): Postgres membership, row locking, and durable snapshots.
- [`src/app/api/sessions/[sessionId]/route.ts`](../src/app/api/sessions/[sessionId]/route.ts): authenticated mutation boundary and planning-vs-coding routing.
- [`src/lib/hive-runner.ts`](../src/lib/hive-runner.ts): Harness/Codex lifecycle, persistent Sandbox, checkpointing, and artifact collection.
- [`src/app/api/github/repositories/route.ts`](../src/app/api/github/repositories/route.ts): server-validated repository attachment.
- [`src/hooks/use-shared-session.ts`](../src/hooks/use-shared-session.ts): polling, presence heartbeat, local-tab broadcast, and offline state.

### 15–18 min — AI journey

Show the brainstorm as evidence of collaboration rather than a perfect linear plan:

- AI helped compare the idea against v0, Claude tagging, and Conductor; the human kept pushing until the product had a real multiplayer interaction.
- AI initially over-indexed on intent governance; the human corrected the product back to a shared agent conversation.
- AI proposed repository-at-provisioning and long-lived rooms; the human clarified late attachment and one-task session lifecycle.
- AI produced a plausible Codex session plan; the human caught that history would disappear with the sandbox, leading to canonical Postgres history plus resumable checkpoints.
- AI accelerated UI, code, migrations, and diagnosis; the human owned scope, trust boundaries, product language, and what not to claim.

### 18–20 min — Boundaries

Be explicit: GitHub write-back is not built; organization administration is not built; sandbox disaster recovery from the canonical transcript is a next layer. The intended product claim is two people collaborating with and steering one real coding agent; do not present it as validated until the two-account check below is complete.

## What is real today

- Dynamic task list and `/sessions/[sessionId]` routes.
- GitHub-authenticated humans with revocable, hashed database sessions.
- Seven-day signed invite links and explicit task-session membership.
- Durable transcript, presence, typing, annotations, steer queue, lifecycle, and workspace state in Postgres.
- Row-locked mutations so concurrent teammate messages survive.
- Conversation with Hive before repository attachment.
- Team-level GitHub App installations and repository picker; one immutable repository per task.
- Fresh repository-scoped installation tokens for private Sandbox clones.
- AI SDK Harness with Codex and a persistent named Vercel Sandbox.
- Successful and failed Codex checkpoints persisted server-side; opaque resume state stripped from clients.
- Real changed-file contents, run output, and git diff; no fake PR, preview, test, or tool-result cards.
- IME-aware message submission that avoids duplicate CJK sends.
- Compact error states that preserve the human prompt and session.

## Current boundaries before final submission

- Retire the previous temporary database after the production migration rollback window closes.
- Verify the migrated production deployment end to end with two GitHub users.
- Implement and verify explicit branch push and PR creation after shared diff review. This is now in scope; acceptance criteria and remaining work are tracked in [GOAL.md](GOAL.md).
- Make the GitHub repository public and submit it with the live URL at least 24 hours before presenting.

## Evidence log

### 2026-09-01

- Removed hardcoded preview, diff, command output, and fake PR artifacts.
- Connected real Postgres state and Vercel Sandbox execution.
- Verified simultaneous messages persist through serialized state changes.

### 2026-09-02

- Registered and installed the `Hive Multiplayer Agent` GitHub App.
- Separated GitHub OAuth identity from repository-scoped installation tokens.
- Verified a private repository clone in Vercel Sandbox.
- Transferred the Vercel project to the credited scope and verified Gateway OIDC.
- Reproduced duplicate CJK sends and added IME regression coverage.
- Added message annotations, explicit steering, and the shared attributed queue.
- Replaced verbose failures with compact system status.

### 2026-09-03

- Replaced the generic tool loop with AI SDK Harness’s Codex adapter.
- Persisted stable Codex IDs, resume checkpoints, and named Sandbox identity across successful and failed turns.
- Verified a resumed live Codex thread executed a real repository command and read `package.json` from the expected working directory.
- Removed browser-selected personas; all authorship now comes from a signed GitHub session.
- Reframed the domain from a long-lived room to a one-task session.
- Added the task dashboard, creation flow, lifecycle, signed invitations, explicit membership, and `/sessions/[sessionId]` routes.
- Added pre-repository planning turns and late, immutable repository attachment from the team pool.
- Removed the unfinished Vercel Connect path and kept direct GitHub App onboarding.
- Renamed database tables to distinguish `auth_sessions` from `task_sessions`, backfilled legacy members and GitHub installation access, and applied the migration without losing the existing demo session.
- Browser-tested task creation, pre-repo agent routing, message annotation, annotation-to-steer promotion, invite copying, completion, and reopening.
- Provisioned a durable Neon Free database through Vercel Marketplace, connected it under an isolated prefix, migrated all six Hive tables with matching row counts, switched production only after verification, and redeployed successfully.
- Production regression: GitHub sign-in, task listing, `Orbit Nav`, its attached private repository, and presence all survived the database cutover; public routes returned 200 and the unauthenticated session API remained 401.
- Verification: 27 focused tests, ESLint, TypeScript, and a production Webpack build pass.

### 2026-09-04

- Created a clean dogfood task against the real `spinsirr/hive` repository for the multiplayer demo.
- Removed the ambiguous workspace Overview tab; repository attachment is now a standalone pre-run state and connected tasks default directly to Diff, with Files and Runs as the only other artifact views.
- Replaced the read-only Terminal metaphor with Runs: a compact, team-facing audit trail where each command exposes its result, duration, and expandable raw output.
- Scope decision: the user added PR creation to complete the task handoff. Planned flow: review the diff, explicitly create a task branch and PR, and persist the real link for the team. This has not yet been implemented or verified.
- The real dogfood run returned Gateway 429 after several successful GPT-5 mini calls. The Gateway dashboard still showed $24.95 free credit, so insufficient balance is not established as the cause. Failed request: `gen_01M1PZHDC9HZCW0E9YCAN48JDA`, 2026-09-04 19:50:11 UTC. Resolving the underlying limit and completing a real code change remain open.
- Reproduced why that failure appeared as a generic error: the Codex bridge throws a raw string, but the error normalizer only read Error objects. Added a regression for raw, wrapped, and nested-cause errors, observed it fail, and fixed the normalizer. This repairs the message, not the upstream rate limit.
- Invite and Complete/Reopen now remain available as accessible icon buttons at narrow widths. Production commit `cc0f2c5` was Ready on Vercel; at the actual 737px browser viewport, Invite and Complete were both visible and enabled. The browser's attempted 375px override did not change the measured viewport, so do not claim mobile-width verification. Live clicks were blocked by the tool's safety approval because they generate an invitation and change task lifecycle; actual action verification needs confirmation.
- Added a lazy-loaded, read-only Monaco viewer with a monochrome syntax theme, file models selected by path, and same-origin editor/worker assets. Local browser verification covered TypeScript and JSON switching, CJK rendering, read-only DOM state, and same-origin script URLs. The temporary local fixture route was removed before deployment; this does not substitute for live agent artifact verification. Files still display bounded changed-file snapshots, not an editable or complete repository browser.
- Verification after these changes: all 27 tests, targeted ESLint, TypeScript, and the production Webpack build passed.
- Two-account testing is not complete. The second account stopped on GitHub's authorization endpoint with a 404. A likely cause is personally owned private App visibility (GitHub restricts sign-in to the owner); App settings are gated by the owner's Confirm access step, so the actual visibility and remedy still need verification. Keep repository visibility separate from App visibility.
- Read-only corroboration: the signed-in owner can view the App profile and existing installation, while an unauthenticated `GET /apps/hive-multiplayer-agent` returns 404. No App permissions or visibility were changed. The formal task transcript also survived the production reload after `cc0f2c5` deployed.
- Repeated a bounded real coding request in the same formal task at 22:45 UTC (add an author-specific accessible label to inline Steer Hive). It again ended with a 429, now displayed as “Rate limit reached. Try again shortly.” No successful code-change claim is supported. A separate no-repository control task was not created: the tool's safety approval requires explicit permission for that production state change.
- Reproduced a client synchronization race with controlled response ordering: delayed polling/action/broadcast snapshots removed a newer human message. Added one shared version guard to all three entry points and kept reset versions monotonic; the regression and cross-task-response checks now pass. This is deterministic local coverage, not a substitute for two-account live testing.
- Fixed the initial reload flash of an empty task by passing the existing server snapshot to the keyed task component. The page and session API now share one public projection, with a regression confirming that Codex resume checkpoints are excluded without mutating durable recovery state. Reconnection/focus also triggers an immediate refresh.
- Verification for the synchronization changes: 32 tests, targeted ESLint, TypeScript, and a production Webpack build pass. Full live network-loss and two-account recovery checks remain open.
- Production verification: Vercel marked commit `3af4c7a` Ready and assigned it to `hive-roan-mu.vercel.app`. Reloading the real task retained the attached repository, attributed conversation, latest coding request, and its failed-run status. GitHub App settings still require the owner's Confirm access; no second-user authorization or App-visibility change has been verified.
- Reproduced a safe-boundary bug: a failed run retained its queued steer but could not apply it, while the same action was incorrectly allowed before the preceding run finished. The task's `running` stage represented both active execution and pending work. A shared active-execution check now gates the reducer and UI; next-steer execution resets its own execution timestamps without replacing the durable Codex identity. New directions stay behind an existing queue after failure.
- Moved execution ownership into the row-locked transition. The session API now receives both the exact accepted state and whether that request started a run; it no longer infers ownership from equal wall-clock timestamps or a later snapshot. Same-millisecond inputs have deterministic regression coverage. This is not a claim that live two-user concurrency has been verified.
- Local browser verification used the real Hive component and reducer against a temporary, in-memory API fixture with no real accounts, database, or model calls. Verified: next steer disabled while running; enabled after failure and completion; refresh retains the pending queue; applying preserves the issuing member; removing the last pending steer restores review; Complete makes the composer read-only and Reopen restores editing. These checks did not perform the previously blocked production lifecycle/invite actions.
- A 375px iframe fixture reported its actual inner viewport as 375px. Rendered screenshots and the accessible tree showed Invite, Complete, and the queue action fitting the narrow layout. This supplements the earlier 737px production check, not a claim of a real-device production test. All five temporary fixture files were removed before the production build.
- Verification after the safe-boundary changes: 37 tests, targeted ESLint, and a production Webpack build including TypeScript pass. The production build route list contains no QA endpoints. Real coding remains blocked by Gateway 429, and second-account onboarding remains blocked at GitHub authorization.

### Onboarding security follow-up

- After the owner's Confirm access step, the GitHub App's Advanced settings explicitly showed **Make public**. The App is private; this confirms the suspected reason the second account cannot authorize. The owner approved making the App public only after adding invitation-only admission; the code repository stays private.
- Found why visibility alone was insufficient: any GitHub identity previously received a Hive account, could create its own task, and then query the single team's repository pool. The private App prevented unrelated accounts from reaching that path; no unauthorized access is claimed.
- Added admission inside account/session creation, before persistence: existing members retain access, the App owner is verified through GitHub's authenticated App endpoint for bootstrap, and new members need a correctly signed, unexpired invitation to an existing task. Merely installing the App is not admission. No new multi-team model or manual account allowlist was introduced.
- Invitations preserve their existing seven-day token format. Duplicate parameters, wrong-task or expired signatures, missing tasks, and external OAuth return paths are rejected. A denied account switch clears the browser's previous Hive login cookie and shows a compact invitation-required page. The invitation screen states that team members share authorized repository access.
- Verification: 49 tests, targeted ESLint, and a production Webpack/TypeScript build passed. Local rendering verified the invitation-required page. Tests use the real parser/signature/policy but simulate database and GitHub ownership lookups; this is not a two-account live sign-in claim. Local HTTP checks with dummy OAuth credentials also verified local return paths, an invalid-state callback returning 400, and an unauthenticated repository request returning 401; no real authorization was performed.
- Vercel marked `cc16780` Ready and Current on `hive-roan-mu.vercel.app` (deployment `AJiR1Mf4vKLT8FH9pbEQe3HpbTNP`). Unauthenticated production checks confirmed the new invitation-required page is live and both the task and repository APIs return 401. The previous deployment's unauthenticated URL redirects to Vercel SSO, protecting the old build.
- The Make public action was rejected by the tool's safety confirmation, which requires an explicit App-public authorization beyond the short affirmative reply. No retry or alternate mutation was made. The App remains private, as does the code repository; the second-account sign-in remains pending.

### Delivery reliability follow-up

- Reproduced draft loss in the actual Hive composer against a local failure fixture: a rejected POST cleared the unacknowledged Chinese message, and a later successful heartbeat hid the error. Added a per-submission delivery state rather than treating connection health as proof of delivery.
- Added failing state-machine tests for duplicate message retries, retries after an already failed run, and repeated annotation submission. Client-generated UUIDs are now validated at the API boundary and persisted with attributed contributions; the existing row-locked transition suppresses repeat execution for the same accepted submission. Identical text sent intentionally with a new ID, or by another member, remains independent.
- Drafts are stored per task, member, and annotation target in the current tab's session storage, with an in-memory path when storage is unavailable. Identity is persisted before the network request, and refresh restores an unconfirmed draft without sending it. A matching accepted contribution from either the response or normal synchronization clears it. A late response cannot clear a newer draft.
- Local browser verification used the real Hive component and reducer with controlled rejected, accepted, lost, and delayed responses; no model, database, or real GitHub account was used. Verified Chinese draft preservation, refresh without automatic resend, explicit retry producing one message, lost-response reconciliation, annotation refresh/retry, and delayed annotation acknowledgement. The latter exposed a stale callback closing a different message's composer; the corrected callback only closes its own target.
- Deduplication uses the canonical transcript and is scoped to the task and author (and target message for annotations). An explicit task reset clears that history; do not claim permanent exactly-once delivery across reset, or interpret accepted delivery as a successful agent run. Storage retention is limited to the current tab and browser availability.
- The full lint command initially scanned generated Monaco distribution files. Excluded only `public/monaco/**`, matching the existing generated-asset boundary; application source remains linted.
- Verification: all 64 tests, full ESLint, and the production Webpack build including TypeScript passed. All four temporary delivery fixture files were removed before the build, whose route list contains no QA endpoints. Real Gateway 429 resolution and two-account production recovery remain unverified.

### 2026-09-05 — Live multiplayer and mention input

- The owner made the GitHub App public. Its Advanced page now shows **Make private**; the `spinsirr/hive` repository still shows **Private**. The second real account, `josephmreb1`, successfully joined the formal task and its attributed messages appeared in the owner's browser. This resolves the previous authorization blocker.
- A production read-only smoke run returned the actual repository package name and test script. Runs showed the real command with exit code 0. This did not modify code or establish the full coding loop.
- During a subsequent real accessibility task, a new message from `josephmreb1` automatically entered the attributed queue. Refresh retained both users' messages and the queue. Apply next steer stayed disabled while the run was active and became enabled after failure. Annotation promotion, full two-browser recovery, and successful queued execution are still not verified.
- The accessibility run failed at 04:33:15 UTC after five successful model requests. Gateway request `gen_01M1QXF5YPDPQRDQ220X8R5GNG` returned 429; the corresponding single Hive invocation logged Codex's exhausted retry limit. Applying the retained `hi` steer also ended in a rate-limit error at 04:39. Do not claim the coding task or failure recovery succeeded.
- The dashboard showed $24.91 **Free Credit**. Three recorded longer runs each had five successes followed by a 429 within one minute. This suggests a free-tier per-model frequency limit, but the displayed error lacks the provider body or exact limit, so upstream limiting is not ruled out. [Vercel's rate-limit documentation](https://vercel.com/docs/ai-gateway/rate-limits) distinguishes credit balance from request rate and Gateway tiers from the site's subscription plan. No billing, model, or routing setting was changed.
- Added conversation `@` autocomplete using the existing Base UI dependency: only other actual session members are suggested, with name/handle filtering, caret-aware insertion, keyboard and pointer selection, and a compact monochrome popup. Selecting a leading GitHub handle uses the existing human-only message route; it does not add a new agent wake-up policy.
- Local interaction checks covered typing `@`, filtering, arrow-key and pointer selection, Enter selecting without sending, empty results, Escape preserving the draft, and a Chinese multiline message sent once. The test found and corrected the library's default Escape input-clearing behavior. IME submission guards remain covered by existing unit tests; this is not a claim of a hardware IME test.
- The temporary mention fixture uses no accounts, database, or model calls and was removed before the production build. Unit verification: 70 tests pass, including mention parsing, current-member exclusion, Chinese name matching, insertion in the middle of existing text, and compatibility with the actual teammate-message router. Production autocomplete verification is pending deployment.

## Questions to prepare for

- How is Hive different from tagging Claude in a shared channel?
- How is it different from multiple people opening one v0 session?
- When does Hive wake, and who can redirect it?
- What happens when two teammates steer at once?
- Why use an existing coding harness?
- Why one task and one repository per session?
- What survives if a Sandbox disappears?
- What is real versus intentionally out of scope?
- Where did AI help, and where did human judgment change the plan?
