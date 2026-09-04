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

I built the smallest full-stack version that proves that interaction. GitHub OAuth provides real authorship, signed invites control session membership, Postgres persists and serializes shared state, a GitHub App supplies team repository access, and AI SDK Harness runs Codex inside a persistent Vercel Sandbox. The product exposes real files, commands, and diffs, while intentionally stopping before branch push and pull-request creation.

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
| Show artifacts, not a generic overview | Diff, changed files, and terminal output each have a clear object and can be verified. | A dashboard tab that mixes repository metadata, status, and summary counts. |
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

Be explicit: GitHub write-back is not built; organization administration is not built; sandbox disaster recovery from the canonical transcript is a next layer. The validated product claim is two people collaborating with and steering one real coding agent.

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
- Real changed-file contents, terminal output, and git diff; no fake PR, preview, test, or tool-result cards.
- IME-aware message submission that avoids duplicate CJK sends.
- Compact error states that preserve the human prompt and session.

## Current boundaries before final submission

- Retire the previous temporary database after the production migration rollback window closes.
- Verify the migrated production deployment end to end with two GitHub users.
- Decide whether to add branch push and PR creation; it is optional for the multiplayer thesis and should only be added if the core demo is already polished.
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
- Removed the ambiguous workspace Overview tab; repository attachment is now a standalone pre-run state and connected tasks default directly to Diff, with Files and Terminal as the only other artifact views.

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
