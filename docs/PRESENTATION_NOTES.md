# Hive — Presentation Notes

This is a living record for the take-home presentation. Update it when a product
decision changes, a meaningful alternative is rejected, or an implementation
claim gains evidence.

## Submission requirements

Submit all four items at least 24 hours before the presentation:

- Public GitHub repository with readable commit history.
- Live deployed URL.
- Written overview covering the problem, key decisions, and AI collaboration.
- A one-to-two paragraph summary blurb.

The presentation is 90 minutes. The product demo should take about 20 minutes
and follow this order: problem, solution, code, AI journey.

Current production URL:
[hive-roan-mu.vercel.app](https://hive-roan-mu.vercel.app/?as=spencer).

## One-sentence product definition

Hive is a multiplayer coding agent session where teammates prompt, annotate, and
steer the same live agent while sharing its transcript, workspace, and execution
state in real time.

The demo is deliberately a Next.js full-stack product, not a static UI concept:
the transcript, presence, annotation, and run lifecycle flow through Next.js
route handlers and persist in Postgres.

## The problem

Coding agents are still primarily single-player: one person owns the prompt,
queue, transcript, and workspace, while teammates enter only after a pull request
exists. Teams copy context between private sessions, send screenshots and links,
and review decisions after the agent has already acted.

The missing primitive is not another team chat. It is a live agent session that
several people can inhabit together: everyone can see what the agent is doing,
comment on its work, steer its next move, and understand who changed its direction.

## The narrow MVP

- One team with two or more people.
- One connected GitHub repository.
- One shared, mutating coding-agent run.
- One live transcript where every human prompt is attributed.
- Shared presence, workspace, files, diff, and run state.
- Comments that can remain annotations or be promoted into agent instructions.
- A visible steering queue while the agent is busy; messages never silently
  overwrite one another.

The demo task is deliberately ordinary: improve a second-level navigation menu
in a connected GitHub repository. The point is to show that even a small
frontend task gives two people many obvious moments to review and redirect the
same agent without requiring domain setup.

## Taste and scope signals

These are the decisions worth emphasizing in the presentation. They demonstrate
judgment more strongly than a long feature list.

### The agent conversation is the primary surface

Hive is not a team room with a bot attached. Every participant is inside the same
agent conversation by default. Human-to-human discussion happens inline through
mentions and annotations without creating a second conversational universe.

### We chose a deliberately ordinary task

A second-level menu is understandable without domain setup, yet it still exposes
a real ambiguity between technically correct output and intended behavior. This
lets the audience understand the problem before spending time learning the demo.

### We distinguish annotate from steer

A teammate can comment on a message, file, preview, or diff without accidentally
redirecting the agent. Promoting that comment to a steer is an explicit action.
This gives multiplayer collaboration a precise interaction model without making
every human message a race to control the run.

### Team speech is addressable, not a flat log

Human messages can carry attributed inline annotations. This lets the team ask a
question about a specific statement without copying it into another chat message
or waking the agent. The transcript becomes shared working context rather than a
chronological pile of prompts.

### The agent knows when humans are talking to each other

Messages default to Hive. A direct teammate mention changes the audience, and the
agent visibly yields instead of answering a question intended for a person. This
small behavior makes the transcript feel genuinely multiplayer rather than like
several people competing for one chatbot input.

### Steering is queued, attributed, and observable

If Hive is already working, new steering instructions join a visible queue with
their author. Teammates can see, edit, or reorder pending direction. Concurrent
input is a product state, not a last-write-wins database accident.

### We implemented the differentiator before the commodity infrastructure

Real cross-client synchronization, concurrent-write safety, and shared run state
were built before repository execution. The next layer reused AI SDK's agent
loop and Vercel Sandbox instead of building a custom container platform. The
multiplayer control layer remains the product-specific part.

### We scoped the system to one team, repository, and mutating run

Multi-tenancy, permissions matrices, repository browsers, and parallel run
orchestration are credible next layers, but none are required to test whether two
people can safely steer one agent. Leaving them out protects both build quality
and the clarity of the demo.

### We used restraint in the interface

The black-and-white Vercel-style system keeps the shared transcript and work
prominent. Presence is visible but quiet; authorship, queued steering, and agent
state carry more weight than decorative collaboration chrome.

### We refuse to overclaim the prototype

The multiplayer protocol, persistence, concurrency behavior, sandbox workspace,
file changes, commands, and git diff are real. GitHub write-back is not: Hive
does not claim to push a branch or create a pull request. Saying exactly where
the product ends is part of the credibility of the submission.

## Core demo sequence

1. Spencer connects the demo repository and asks Hive to improve its second-level navigation.
2. Hive clones it into a persistent Vercel Sandbox and begins a real tool loop.
3. Maya joins the same session and immediately sees its live transcript, status,
   and workspace—there is no handoff summary.
4. Maya annotates Spencer's task statement. The annotation does not interrupt Hive.
5. Maya asks `@Spencer` which state should remain highlighted. Hive recognizes a
   human mention and leaves the question to Spencer.
6. Spencer replies. Maya promotes the resolved comment to **Steer Hive** with the
   constraint to keep the parent expanded and highlight only the active child.
7. Because Hive is working, the steer appears in a visible attributed queue and
   then becomes the next instruction.
8. Hive exposes the actual changed files, terminal output, and git diff to both participants.
9. Both teammates review and approve the same sandbox result. Opening a pull
   request remains outside the current read-only GitHub connection.

## Product decisions and rejected alternatives

| Decision | Why | Rejected alternative |
| --- | --- | --- |
| Call the product and agent **Hive** | One identity represents the shared team agent. | Relay and Orbit were ambiguous product names. |
| Start with one team and one repository | Demonstrates the product thesis without spending the build on tenant administration. | Multi-tenant organizations, roles, billing, and broad repository management. |
| Make multiplayer the product | The missing interaction is several humans inhabiting and steering one live agent session. | Treating collaboration as a secondary intent-approval workflow. |
| Keep agent conversation primary | Every message defaults to Hive; teammate mentions and annotations are inline exceptions. | A separate human Team Room beside an agent workspace. |
| Separate annotate from steer | People need to discuss work without every comment redirecting the run. | Treating all messages as prompts or requiring a formal decision card for every change. |
| Queue and attribute concurrent steering | Multiplayer input must stay visible and deterministic while the agent is busy. | Last-write-wins prompts or silently merging instructions. |
| Use AI SDK + Vercel Sandbox as the harness | The take-home should validate multiplayer control, not recreate agent loops or container infrastructure. | Building a new harness and VM platform within the six-hour exercise. |
| Separate GitHub user identity from repository execution | OAuth proves which human may bind the App installation; a fresh installation token performs the clone with one-repository, read-only scope. | A personal access token, or trusting the spoofable `installation_id` query parameter by itself. |
| Use an ordinary frontend change | Makes the intention problem understandable in seconds. | A deployment workflow that distracts from the core interaction. |
| Use Vercel Marketplace Postgres | Vercel no longer operates a separate Vercel Postgres product; Marketplace provides the managed database and environment integration. | Presenting direct Neon and “Vercel database” as competing architectures. |
| Do not reuse personal Claude/Codex subscription tokens | Product authentication and spend should be auditable and scoped to the app. | Shipping personal setup tokens in a deployed demo. |

## What is real today

- Both participants share the same room state through an API.
- Messages, presence, typing, context revision, and run stage synchronize across
  clients.
- Room state persists in Postgres across server restarts.
- A GitHub App is installed on exactly one private repository. GitHub user OAuth
  verifies that the authorizing human can access the installation before Hive
  persists repository metadata.
- The OAuth user token is used only for that binding check and then discarded.
  Each Sandbox clone gets a newly minted installation token limited to the
  selected repository and `contents:read`; neither credential is persisted in
  room state or exposed to the agent tool loop.
- AI SDK's `ToolLoopAgent` can list files, read files, write files, and execute
  commands inside that sandbox; no production database or application secrets
  are passed into the workspace.
- Changed file contents, command exit codes/output, and the real git diff are
  persisted and rendered identically for both teammates. There are no hardcoded
  preview, test, diff, or PR artifacts left in the interface.
- Messages addressed to Hive route through Vercel AI Gateway, and successful
  model responses persist back into the shared transcript. Production OIDC is
  verified end to end after Hive was transferred to the credited team. A live
  request completed through `poolside/laguna-s-2.1-free` and persisted the
  response into the shared room without a personal provider key.
- Messages explicitly addressed to a teammate stay human-to-human; promoting an
  annotation with **Steer Hive** explicitly wakes the agent.
- Teammates can add attributed annotations directly to human messages. They sync
  across clients as discussion-only context until someone explicitly promotes
  one into a Hive steer.
- Steers created during an active run persist in an attributed FIFO queue. Both
  clients can see and reorder the same queue, and Hive consumes the next item at
  an explicit safe boundary rather than being interrupted mid-step.
- Concurrent teammate writes are serialized with a row lock and transaction;
  both messages survive and the room version increments twice.
- The UI exposes loading and offline states instead of failing only in the
  console.
- The state machine can also be exercised independently from the browser.

## Current implementation boundary

- Private repository connection is implemented with GitHub App installation
  tokens plus user OAuth. The GitHub App is deliberately installed on one
  selected repository for this single-team demo.
- Sandbox execution is connected, but GitHub write-back is not. Hive does not
  push branches or create pull requests yet.
- The deployed app currently uses the temporary Postgres database created during
  development. It expires on September 4, 2026, so final submission needs a
  durable Vercel Marketplace database attached to the deployed project.
- AI Gateway uses Vercel OIDC rather than a personal provider key. Local model
  calls require the project to be linked and its environment pulled first.
- A completed tool loop is the current safe boundary. If teammates queued a
  steer while it ran, the next item resumes the same named sandbox workspace.

These are deliberate scope boundaries, not hidden claims. The presentation
should distinguish the validated product interaction from the replaceable
execution infrastructure.

## Code walkthrough anchors

- `src/lib/room.ts`: pure domain state machine and the current boundary between
  participant messages and agent lifecycle events.
- `src/lib/room-store.ts`: transactional persistence and concurrent-write
  serialization.
- `src/lib/hive-runner.ts`: AI SDK tool loop, Vercel Sandbox lifecycle, guarded
  repository paths, command capture, changed files, and git diff collection.
- `src/lib/github-oauth.ts`: signed OAuth state, one-time user authorization,
  and user-to-installation verification.
- `src/lib/github-app.ts`: App authentication and repository-scoped,
  `contents:read` installation tokens for Sandbox cloning.
- `src/app/api/rooms/orbit-nav/route.ts`: the small HTTP boundary for presence
  and room actions.
- `src/hooks/use-shared-room.ts`: browser synchronization, presence heartbeat,
  local-tab broadcast, and connection failure handling.
- `src/components/hive/hive-workspace.tsx`: the shared session, agent workspace,
  and staged review experience.
- `drizzle/0000_early_captain_stacy.sql`: reproducible database schema.
- `drizzle/0001_flat_richard_fisk.sql`: persisted steering queue and active
  steer state.

## AI journey

### Human-driven decisions

- Chose the real pain: team context is fragmented across agents and platforms.
- Narrowed the first user to a single team with two or more people.
- Selected coding agents rather than a generic team assistant.
- Insisted that the product demonstrate real multiplayer behavior.
- Corrected the product from an intent-governance workflow back to a multiplayer
  agent where the shared agent conversation is primary.
- Defined the core human actions as annotate and steer.
- Chose a normal second-level menu task and the name Hive.
- Chose to reuse a coding harness rather than make harness construction the
  product.

### AI-assisted work

- Structured the brainstorm into problem, user, wedge, and demo narrative.
- Compared the concept against v0, Claude workflows, and Conductor to avoid a
  weak “shared session” pitch.
- Produced and evaluated multiple UI directions before promoting the selected
  layout.
- Implemented the reducer, two-client synchronization, transactional Postgres
  layer, connection states, database migration, and verification scripts.
- Used browser-driven QA to test the experience as both Spencer and Maya.

### Useful surprise / correction

The first database was provisioned directly as a temporary Neon database. During
review, the distinction was corrected: new Vercel projects use Marketplace
database providers, and the production choice should be Neon through Vercel
rather than treating Neon as an alternative to a current first-party Vercel
Postgres product. This is a useful example of AI accelerating implementation
while the human still challenges architectural framing.

The first production deploy also produced useful evidence instead of a vague
"Gateway is broken" conclusion. Vercel OIDC authenticated successfully and the
request reached AI Gateway; the actual response was a billing-verification 403
on the personal scope. Moving the project to the credited team changed that
failure to a model-tier restriction, proving the transfer and OIDC path worked.
Switching debugging to the free, tool-capable Laguna model then completed the
same request end to end. This separates application correctness from account
configuration and preserves the decision not to ship a personal model token.

The AI also over-indexed on “binding team intent” as the product wedge. The human
corrected the concept by pointing back to Conductor's concrete multiplayer
example: several people share one agent transcript, direct messages to teammates,
annotate work, and steer the same running agent. Intent checkpoints remain a
supporting conflict mechanism rather than the product identity.

## Suggested 20-minute demo pacing

- **0–3 min — Problem:** coding agents are still single-player while software
  work is collaborative.
- **3–9 min — Solution:** open Spencer and Maya views, join the same live agent
  transcript, annotate work, mention a teammate, and steer Hive together.
- **9–14 min — Code:** state machine, transaction boundary, synchronization hook,
  and failure handling.
- **14–18 min — AI journey:** show the narrowing process, UI alternatives, human
  overrides, and the Neon/Vercel correction.
- **18–20 min — Tradeoffs:** why the harness is replaceable, what remains outside
  scope, and the next production layer.

## Questions to be ready for

- How is Hive different from tagging Claude in a shared channel?
- How is it different from multiple people opening the same v0 session?
- When does the agent wake up, and who is allowed to redirect it?
- What happens when two teammates steer the agent at the same time?
- Why use an existing coding harness?
- Why is the demo task intentionally small?
- What is real versus simulated?
- What would change for multiple teams, repositories, and simultaneous runs?
- Where did AI help, and where did the human override it?

## Evidence log

### 2026-09-01

- Removed the hardcoded Orbit preview, sample diff, sample test output, and fake
  PR claim rather than carrying them forward as a fallback.
- Added public GitHub repository connection and persisted repository/workspace
  state to the shared Postgres room.
- Connected an AI SDK `ToolLoopAgent` to a named persistent Vercel Sandbox with
  list, read, write, and command tools, plus real changed-file and git-diff
  collection.
- Connected `vercel/examples` in QA and verified Vercel created the running
  `hive-orbit-nav-99019a56e6b7` sandbox with Hive's room tags.
- Verified both Spencer and Maya see the same connected repository and exact
  execution error. The remaining blocker occurs before the first model-selected
  tool: AI Gateway returns `customer_verification_required` for the personal
  Vercel scope.
- Promoted the selected black-and-white Vercel-style interface.

### 2026-09-02

- Registered the private `Hive Multiplayer Agent` GitHub App and installed it
  only on `spinsirr/hive` rather than granting account-wide repository access.
- Replaced the public repository URL input with a GitHub App installation flow.
- Added GitHub user OAuth as a trust boundary: the setup URL's
  `installation_id` is never sufficient on its own; Hive confirms that the
  authorizing user can access that installation and records the GitHub identity
  responsible for the connection.
- Kept user authentication and execution credentials separate. Hive discards
  the OAuth token after binding and mints a one-repository, `contents:read`
  installation token only when Vercel Sandbox clones the repository.
- Verified the production OAuth round trip as `@spinsirr`. The shared room
  persisted GitHub user ID `73987208`, installation `158515678`, and private
  repository ID `1354870915` without persisting either OAuth or installation
  credentials.
- Verified the live `hive-orbit-nav-76a592497728` Vercel Sandbox cloned the
  private repository on `main` at commit `4d0c15f`; `README.md` was present and
  the git worktree was clean.
- Diagnosed a blocked Vercel deployment from deployment metadata rather than
  treating it as a build failure: the original commit email was not a member of
  the Hobby team. A clean commit attributed to the project owner's Vercel
  identity deployed successfully, and production was re-aliased to the stable
  demo URL.
- Transferred the existing Hive project into `spinsirrs-projects`, preserving
  its stable domain and production environment variables while moving AI
  Gateway usage onto the credited team scope.
- Verified the transferred production deployment with a real persisted Hive
  response. Kept debugging on the free, tool-capable Laguna model so credits
  remain available for deliberate presentation-quality model runs.
- Renamed the product and shared agent to Hive.
- Verified two browser participants synchronize messages and state transitions.
- Added Postgres persistence and a reproducible Drizzle migration.
- Verified two simultaneous messages both persist (`version 1 → 3`).
- Verified state survives a development-server restart.
- Passed TypeScript, ESLint, and a production webpack build.
- Implemented the shared transcript's Vercel AI Gateway path with
  `poolside/laguna-s-2.1-free` as the zero-cost debugging default model.
- Verified that a missing Gateway credential produces an attributed in-product
  error without losing the human prompt or taking the shared room offline.
- Made the wake-up boundary explicit: team prompts wake Hive, teammate mentions
  do not, and promoted annotations do.
- Added attributed inline annotations to human messages and verified that an
  annotation created by Spencer appears in Maya's live view.
- Verified that promoting the message annotation updates both clients, advances
  the shared run to v2, and passes the annotation plus its source message to Hive.
- Added a persisted, attributed steering queue for input that arrives while Hive
  is running; verified two teammates' items both survive and appear on both
  clients.
- Verified shared reordering, removal back to discussion-only, and one-at-a-time
  consumption at the next safe boundary.
