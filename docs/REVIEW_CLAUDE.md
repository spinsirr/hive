# Hive full-tree independent review (Claude Code)

- **Reviewed**: 2026-09-09 (Pacific) / early 2026-09-10 UTC
- **Baseline**: HEAD `2799196ed42714e6f63135d605766b2708bb7073` (`docs: record live memory boundaries and Gateway evidence`)
- **Working tree at start**: `## main...origin/main [ahead 1]`, with uncommitted evidence-document updates and the review handoff. The review covers that working tree, including its uncommitted docs. Documentation paths have since been reorganized; line references below describe the reviewed revision.
- **Working tree at end of the review**: unchanged apart from this report. The `origin/main` tracking ref was fast-forwarded to `2799196` at 18:52:53 −0700 by a background `fetch` that I did not start (the reflog shows `fetch --no-recurse-submodules --no-write-fetch-head`, typical of an IDE), which is why `[ahead 1]` disappeared. I ran no push, pull or fetch. Conclusion: HEAD is already on GitHub.
- **Evidence sources**: the current repository, the installed dependency versions in `node_modules`, and controlled local tests. The CoreSpeed memory connector was available; three queries (Hive / team-agent-ui-prototype / Codex harness Mem0 / Vercel Neon) returned **no Hive-related decisions** (only unrelated HaaS/AE entries). Nothing was written to CoreSpeed memory during this review.
- **Boundaries**: `.env.local` and all credentials were left unread; no production database, Vercel, Mem0, model or real GitHub account was touched; nothing was committed, pushed or deployed; source code was not modified during the review itself. The only additions were this file and explainable local build products (`.next/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, all gitignored).

---

## 1. Overall conclusion

**The core collaboration path works, but two P1 issues can interrupt an active task and should be fixed before broader use.** No confirmed P0 was found (privilege escalation, credential leakage, cross-task or cross-account IDOR). The core boundaries — auth/membership/repository intersection, frozen Threads, row locks and idempotency, private native-history projection, safe file reads, tool-capability fencing — hold up in the source and in the local real-Postgres integration checks.

Risks that block the core path, ordered by demo impact:

1. **The `Reset session` button**: any member, one click, no confirmation, allowed while a run is in progress. It irreversibly erases the whole team conversation (Threads, code annotations, queue, approval), silently discards the result of the running Codex turn and orphans the old sandbox. One accidental click during the two-account demo destroys it.
2. **A task stays `running` forever after its worker dies**: `maxDuration = 300`; once a Codex turn exceeds five minutes or the function crashes, no non-destructive action brings the task back (every message queues; Apply, Approve and Restore are all disabled). The only way out is the Reset above. The docs disclose "recovery after hard worker termination is unverified", but not "there is no recovery control, and the only exit destroys the conversation".

The remaining P2 items are correctness and cost issues (server-zone time labels, unbounded message bodies, Files reads holding pooled connections, a single failed streaming checkpoint aborting a turn, public snapshots carrying file contents the UI never renders). They do not block the demo, although the time labels are visible to the audience.

"Demo-ready" is not "enterprise production-safe": request-bound execution, one LISTEN connection per instance, whole-row JSONB rewrites, no membership revocation and no invitation revocation are known prototype boundaries.

---

## 2. Findings

Severity (P0–P3) and confidence are reported separately. "Reproduced" means a controlled local reproduction (pure reducer/stream handling, no Sandbox or model); "static" means the conclusion rests on the code path alone.

### P0

None. No finding has enough evidence to count as a "severe security/data risk requiring immediate action".

### P1

#### P1-1 `Reset session`: one click, no confirmation, allowed mid-run, irreversibly clears the shared conversation

- **Files/lines**: `src/components/hive/hive-workspace.tsx:217-227` (button disabled only during a restore, `onClick={onReset}` with no confirmation), `:789-793` (dispatches `{ type: "reset" }` directly); `src/lib/task-session.ts:414-447` (reducer has no run-active/queue guard, replaces `messages` with a single entry, drops queue/approval/threads, mints a new `agentSession.id`); `src/app/api/sessions/[sessionId]/route.ts:85` (any member may POST `reset`).
- **Trigger**: any member clicks the round `RotateCcw` icon on the right of the header (`title="Reset shared session"`), including while Hive is running.
- **Expected**: the product vocabulary (`CONTEXT.md`) treats the conversation as the audit trail and requires Restore to be confirmed and idle; README never mentions Reset. Either the action should not exist or it needs confirmation plus an idle gate.
- **Actual (reproduced, see §4 repro (a))**: 4 messages → 1; 1 queued steer → 0; `liveReply` gone; `agentSession.id` changed. Consequences: (1) when the in-flight Codex turn finishes, `appendHiveReply` returns early because `forReplyId` no longer matches (`task-session-store.ts:324`), so the result, diff and commands are discarded while Gateway/Sandbox keep billing until the turn ends; (2) the new agent session id yields a new sandbox name (`hive-runner.ts:288`, `hive-sandbox.ts:24-36`), so the old sandbox and its snapshots are orphaned and Files/Checkpoints can no longer read them; (3) there is no history table, the JSONB is overwritten in place, nothing can be recovered.
- **Impact**: team data loss plus a live-demo accident (one mis-click while operating two accounts).
- **Confidence**: high (statically certain, reducer reproduced).
- **Minimal fix direction**: remove it from the product UI (it is not in the vocabulary), or add a confirmation dialog and make the reducer/route reject it while `isHiveRunActive || activeSteer || steeringQueue.length` (return 409). Regressions: reducer test "reset is rejected while running or with queued input"; component test "no dispatch without confirmation".

#### P1-2 A task stays `running` forever after its worker terminates, with no non-destructive recovery path

- **Files/lines**: `src/app/api/sessions/[sessionId]/route.ts:28` (`maxDuration = 300`; after the timeout Vercel kills the function, `startedAt` is already written, `completedAt` never is); `src/lib/task-session.ts:326-331` (`isHiveRunActive` has no time bound); only `applyHiveRunResult/applyHiveRunError` write `completedAt`, and both are invoked only inside that same route invocation; `src/lib/workspace-restore-state.ts:14-18` (restore is blocked by `isHiveRunActive`).
- **Trigger**: any coding turn longer than 300 s (`pnpm install` plus tests in a 1-vCPU sandbox can easily take that; the recorded recall probe route lasted 85.1 s and implementation turns 2–3 minutes), a function OOM/crash, or instance recycling.
- **Expected**: members can, after confirmation, mark a dead run as failed (keeping transcript and queue), or the system detects the timeout.
- **Actual (reproduced, repro (b))**: three hours later `send-message` still queues, `apply-next-steer` and `advance-run` are no-ops, `canApplyNextSteer=false`, restore returns "Wait for Hive to finish before restoring a checkpoint." The only action that changes the state is the Reset in P1-1.
- **Impact**: blocks the core path (the task can never execute another agent request); combined with P1-1, "recovery = destroy the conversation". The demo script needs a real check to complete within minutes 6–8; if it overruns, the Checkpoints segment at 9:00–10:00 and the subsequent Apply become impossible.
- **Confidence**: state machine high (reproduced); "Vercel definitely kills at 300 s" is platform behaviour not verified locally, but that is what `maxDuration` means.
- **Minimal fix direction**: a member-triggered `mark-run-failed` on top of `applyHiveRunError` (or detection on snapshot read when `startedAt < now − (maxDuration + grace)`), with its own copy ("execution process lost"), keeping queue and messages and not rerunning automatically. Regressions: reducer/store tests plus route 400/409 boundaries. This is a fix, not a feature, and within scope.

### P2

#### P2-1 Conversation time labels render in the server's time zone, and three time sources disagree

- **Files/lines**: `src/lib/task-session.ts:305-310` (`timeLabel` without `timeZone`; Vercel functions run in UTC); `src/lib/workspace-restore-state.ts:58` (restore message hard-codes `America/New_York`); `src/components/hive/thread-reply.tsx:23` (Thread replies use the browser's zone). `ChatMessage` stores only the string `time`, no epoch.
- **Actual (reproduced, repro (d))**: the same instant 2026-09-09T18:52Z renders "6:52 PM" with TZ=UTC, "11:52 AM" with TZ=America/Los_Angeles and "2:52 PM" with TZ=America/New_York. In production the main messages show UTC hours, Thread replies on the same screen show local hours, and restore messages show Eastern time.
- **Impact**: misleads users and reviewers ("Hive replied at 6:52 PM" was actually 11:52 AM Pacific) and makes UTC/Pacific/EDT times in the evidence log hard to match.
- **Confidence**: high.
- **Fix direction**: add optional `ChatMessage.createdAt: number` (an additive JSONB field, no migration) and format it on the client with `Intl.DateTimeFormat`; fall back to `time` for old messages. Remove the hard-coded zone from the restore message. Regressions: snapshot serialisation test plus component rendering.

#### P2-2 The main composer has no message-body limit; the body reaches storage, every viewer and the model prompt

- **Files/lines**: `src/app/api/sessions/[sessionId]/route.ts:97-102` (only a non-empty check; compare `:115-117` replies capped at 4,000 and `:142-145` code annotations at 500); `src/lib/task-session.ts:494-565` (no length limit in the reducer); `src/components/hive/hive-workspace.tsx:426-437` (`MentionInput` without `maxLength`, whereas `message-thread.tsx:80` passes 4000); `src/lib/hive-prompt.ts:96-104` (the last 12 messages go into the prompt in full).
- **Actual (reproduced, repro (c))**: a 4 MiB message is accepted and starts a run.
- **Impact**: one accidental log paste permanently bloats the JSONB row, gets rewritten on every mutation, is transferred to every viewer on every snapshot, and blows up the model context (Gateway 429/cost). Given the September 8 Neon egress incident this is a real cost/reliability risk.
- **Confidence**: high.
- **Fix direction**: one consistent cap (for example 8,000–16,000 characters) in route, reducer and UI, aligned with the 4,000-character reply policy. Regressions: route returns 400, reducer ignores, UI `maxLength`.

#### P2-3 Files reads hold a database connection inside a transaction until the Sandbox call returns, which can exhaust the pool

- **Files/lines**: `src/lib/task-session-store.ts:392-402` (`db.transaction` takes `pg_try_advisory_xact_lock_shared` then `await read(session)` directly); `src/lib/workspace-browser.ts:25-40` (`Sandbox.get({ resume: true })` may need to wake the VM, `runCommand` has a 15 s timeout); `src/app/api/sessions/[sessionId]/files/route.ts:29-30` (45 s overall); `src/db/index.ts:27` (`max: 5`, no `connectionTimeoutMillis`, so waits are unbounded); `src/components/hive/workspace-files.tsx:33-51, 89-98, 109-110` (opening Files issues parallel requests for the root, every ancestor directory of `initialPath` and the selected file, typically 3–4).
- **Trigger**: one member opens Files (3–4 concurrent reads each hold a connection until the VM wakes and the command returns) while another member sends a message, the WebSocket reconnects, or a streaming checkpoint is written; the same instance's pool has 1–2 connections left and further requests wait indefinitely.
- **Expected**: the advisory lock exists to drain readers before a restore; it does not need to monopolise a database connection during provider calls.
- **Confidence**: medium-high (static; reproduction needs a real Sandbox, which was not used).
- **Fix direction**: turn the lock into a lightweight counter or a short transaction (read the `restore` flag and commit immediately), or use a small separate pool for file reads; at minimum set `connectionTimeoutMillis` on the Pool so failures become visible.

#### P2-4 One failed streaming checkpoint save aborts the whole coding turn

- **Files/lines**: `src/lib/agent-stream.ts:43-54` (`flush` catches the save error into `failure`; the next `push` throws it); `src/lib/hive-runner.ts:411-418` (`consumeAgentText(..., (body) => auth?.onText?.(body))`: `onText` throws → the `for await` loop breaks → the catch path calls `agentSession.stop()` and ends with the generic "Run failed").
- **Actual (reproduced, repro (e))**: after the first `checkpointAgentReply` fails, the second text delta throws "transient pool timeout" and the whole turn is marked failed.
- **Impact**: a Neon hiccup or pool wait (see P2-3) during a long run ends it early even though Codex is progressing; the catch path still saves artifacts and a checkpoint, but members see "Run failed. Try again." and the native turn is interrupted.
- **Confidence**: high.
- **Fix direction**: make progress checkpoint failures non-fatal (`push` stops rethrowing), report only in `close()`; the final `appendHiveReply` keeps its fence. Regression: the existing "checkpoint failure propagates" case in `agent-stream.test.ts` should become "reported at the end, never interrupts".

#### P2-5 After a lost or deleted persistent Sandbox, the task's only recovery path is Reset

- **Files/lines**: `src/lib/hive-runner.ts:304` (whenever `resumeFrom` exists the runner always calls `Sandbox.get({ name })`, never `getOrCreate`); `src/lib/hive-agent.ts:42-75` (errors collapse to generic copy).
- **Trigger**: the provider deletes or expires the sandbox, or `snapshot_not_found`. Every subsequent turn shows "Run failed. Try again." with no re-clone entry point; only the Reset from P1-1 produces a new sandbox, at the price of erasing the conversation.
- **Note**: README already discloses that "permanent-Sandbox-deletion recovery" is unproven, but not that the recovery path destroys the transcript.
- **Confidence**: medium (static; provider behaviour not tested).
- **Fix direction**: catch not-found errors and offer a member-confirmed "re-clone the working copy" action (new agent session id, keep messages/queue), or at least a specific message.

#### P2-6 The public snapshot ships changed-file contents the UI never renders, and re-sends everything to every viewer on each mutation

- **Files/lines**: `src/lib/task-session-store.ts:441-448` (the SQL projection removes only `checkpoints` and `agentSession.resumeFrom`, keeping `workspace.files` (≤12 × ≤20K chars), `diff` (≤60K) and `commands` (≤20K each)); `src/lib/session-live.ts:89-97` (every snapshot notification re-sends the full snapshot to every viewer); `src/components/hive/hive-workspace.tsx:653` (the only consumer is `workspace.files[0]?.path`; the Files pane reads on demand). `applyTaskSessionAction` also rewrites the whole row via `set(sessionValues(next))`, including three checkpoints (each with files/diff/commands/resumeFrom).
- **Impact**: cost/egress (Neon reads plus Vercel outbound) grows linearly with message count; correctness is unaffected. The September 8 incident removed the heartbeat full re-read; this is the largest remaining fixed overhead.
- **Confidence**: high (static; not quantified).
- **Fix direction**: replace `files` in the public projection with a list of paths (or only the first path); truncate `commands.output` to a preview and fetch on expand.

### P3

#### P3-1 Invitation links: seven days, unlimited uses, irrevocable, mintable by any member, join on GET, token left in the URL

- `src/lib/session-invite-token.ts:3` (seven days), `src/app/sessions/[sessionId]/page.tsx:53-56` (page GET calls `joinTaskSession` directly with no confirmation; the URL keeps `?invite=` after joining, entering browser history and server access logs), `:63` (a token is generated for every member on every render), `src/lib/session-invite.ts:5-14` (without `HIVE_INVITE_SECRET` signing falls back to the GitHub OAuth client secret, a secret reuse; production has the dedicated value, but the code path remains). Revocation requires rotating the secret, which also signs agent-tool capabilities.
- Design-level trade-off, not a defect; consider redirecting to a clean URL after joining and documenting that "any holder can join within seven days and a link cannot be revoked individually".

#### P3-2 Dead code and prototype leftovers: `steer-agent`, `annotation` state and the hard-coded `AnnotationCard`

- `src/lib/task-session.ts:289-291` (`annotation.text` starts as "" and is never assigned anywhere else) → the `steer-agent` branch at `:751-812` is always a no-op; `src/components/hive/hive-workspace.tsx:233-263` ("Maya annotated Preview"/"MC" fixed copy, `Reply` button without a handler) is rendered at `:422` behind `workspaceAnnotation`, so it is unreachable; `src/lib/task-session.ts:21-36` `memberDirectory` fixtures (Spencer Zhao/Maya Chen) are still the fallback names for unknown members (`resolveMember`). The route still accepts `steer-agent`. Recommend removal to avoid confusing reviewers.

#### P3-3 The Diff gutter shows diff-text line indices, not file line numbers

- `src/components/hive/diff-pane.tsx:19` (`index + 1`). A reviewer reading "37" assumes file line 37. Parse hunk headers or drop the numbers.

#### P3-4 Recall provenance fields have no human-readable labels, consistent with the observed `来源任务：initial-1` ("source task: initial-1") defect

- `src/lib/hive-memory-recall.ts:31-45`: the JSON injected into the prompt uses bare keys `sessionId`/`messageId`/`replyId`, and the header never says "sessionId is the source task". The mapping in `src/lib/hive-memory.ts:67-75` and the Mem0 metadata are correct (`source_session_id → sessionId`), and unit tests plus `check-memory-recall.mjs` cover them. So there is no database/adapter mapping bug; the defect arises when the model maps "task" onto the wrong key, a prompt/formatting clarity issue.
- Confidence: medium (a plausible explanation, not re-verified with the model). Rename to `sourceTaskId/sourceMessageId/sourceReplyId`, add a one-sentence field description, and pin it in `check-memory-recall.mjs`.

#### P3-5 Run-failure copy is over-collapsed

- `src/lib/hive-agent.ts:42-75` maps sandbox creation failures, dependency repair failures, clone failures and more to "Run failed. Try again." (`hive-error-copy.ts:6`); the cause exists only in Vercel logs. This is in tension with "Show honest failures" and leaves the user unable to judge whether to retry. Keep a few categories (Workspace unavailable / Repository unavailable / Rate limit).

#### P3-6 Two overly strict success checks in the Codex bridge

- `src/lib/codex-bridge/app-server.mjs:236` (the completed text must extend the streamed prefix, otherwise the turn throws) and `:278-287` (after stdin EOF the app-server must exit 0 within 4 s or the turn is reported as "did not shut down cleanly"). Work that finished is reported as failed; the catch path still keeps the artifacts. Not observed in production; a fragility.

#### P3-7 Attaching a repository while a planning turn is active silently discards that turn's reply

- `src/lib/task-session.ts:449-492` (no run guard; the new workspace object drops `liveReply/startedAt`) → the `task-session-store.ts:324` fence discards the result; the repositories POST route has no run check. Reproduced (repro (f)). Low probability; one lost agent reply and one wasted model call.

#### P3-8 Smaller items

- `src/app/api/sessions/[sessionId]/route.ts:61-66`: the POST lacks the explicit Origin check that the repositories/checkpoints POSTs have; mitigated by `SameSite=Lax` cookies (`vercel.app` is on the PSL, so cross-site POSTs carry no cookies), a defence-in-depth gap only.
- `src/lib/auth-session.ts`: expired `auth_sessions` rows are never purged.
- `src/lib/github-oauth.ts:242-260` + `repositories/route.ts:123`: listing and attach page through every installation (N+1) and repeat it at attach time; irrelevant for a small team.
- `src/lib/session-live.ts:87-93`: during streaming every `reply` notification triggers two authorisation queries plus one reply read per socket (about every 250 ms), roughly 12 queries/s per viewer; authorisation could be cached per socket for a few seconds. `:127` closes every socket after 270 s and the reconnect fetches a full snapshot.
- `src/components/hive/hive-workspace.tsx:510-544`: after a successful attach the client does not publish the returned result and waits for the WebSocket snapshot; with the socket down the spinner never ends. `:727-736` `copyInvite` gives no feedback when the clipboard write fails.
- Streamdown defaults to `allowedLinkPrefixes: ["*"]` (`node_modules/streamdown/dist/index.js`), so any link in agent Markdown is clickable (`target=_blank rel=noreferrer`); repository content can influence agent output, a low-risk untrusted-content surface.
- Unreferenced third-party components and dependencies: `src/components/ai-elements/{terminal,test-results,commit,file-tree}.tsx` have no consumers; `ansi-to-react` and `cmdk` are only used by those unused components / `ui/command.tsx`; `message.tsx` still bundles `@streamdown/math` and `@streamdown/mermaid` into the client (`AgentResponse` overrides `plugins` to `{cjk, code}`). Maintenance/bundle size only.
- The 12-file, 60K-diff and 20K-command-output caps (`hive-runner.ts:35-37`) are not documented in README/SETUP; Diff shows "[output truncated by Hive]" when hit.

### Unverified risks (not counted as defects)

- **Whether clone credentials persist in the sandbox `.git/config`**: `Sandbox.getOrCreate({ source: { type: "git", username, password } })` (`hive-runner.ts:304-324`). The file-read script refuses `.git` (`workspace-read-script.ts:10-14`), but Codex runs with `danger-full-access`; if the provider writes the tokenised URL into the remote, the model or repository scripts could read it. The token is one hour, read-only, single repository. Needs provider documentation or a real sandbox to verify.
- Behaviour after hard worker termination and Sandbox expiry (disclosed in the docs).
- Live cross-repository memory isolation (fixtures cover the `hive_scope` filter and `user_id` derivation).
- A brand-new GitHub account's first signup and real cross-account isolation (passed locally on real Postgres with controlled GitHub HTTP).
- Which layer imposes the Gateway 429 and its quota window (disclosed).

---

## 3. Coverage matrix

| Area | Paths reviewed | Tests/checks used | Status |
| --- | --- | --- | --- |
| **A. Auth / task / repo isolation** | `auth-session.ts`, `github-oauth.ts`, `github-user-session.ts`, `github-login-origin.ts`, `github-app.ts`, `session-invite*.ts`, `return-to.ts`, all `api/github/*`, `api/auth/logout`, `actions.ts`, `page.tsx`, `sessions/[sessionId]/page.tsx`, the auth heads of `api/sessions/**`, `db/schema.ts`, all 8 migrations | Unit tests (invite/oauth-origin/tool-token); `pnpm test:onboarding` ran for real against a disposable local Postgres, 9 checks (first login, creator spoofing denied, same-installation cross-account repo isolation, forged/revoked repo attach denied, six endpoint classes deny non-members, joining by invite does not inherit repo permissions, tampered/expired/cross-account GitHub cookie fails closed, logout revokes one login) | **Verified** (locally). Real new account in production: not verified (needs a real account). Findings: P3-1 |
| **B. Multi-user input / state machine / consistency** | every action in `task-session.ts`, row locks and fences in `task-session-store.ts`, `task-session-snapshot.ts`, `hive-prompt.ts`, `hive-conversation.ts`, `teammate-mention.ts`, `use-shared-session.ts` | 150 unit tests (same-millisecond double start, duplicate clientId, stale run callbacks, frozen thread, author/promoter/applier); `check-workspace-files.mjs` verifies thread-steer idempotency through the real route; local repros (a)(b)(c)(f) | Core **verified**; **findings P1-1, P1-2, P2-2, P3-7**. Concurrent `for update` contention on real Postgres was not stress-tested (onboarding/egress run serially) |
| **C. Harness / Sandbox / streaming / recovery** | `hive-runner.ts`, `codex-harness.ts`, `hive-agent.ts`, `hive-sandbox.ts`, `codex-bridge/*.mjs`, `agent-stream.ts`, `workspace-restore*.ts`, `api/sessions/[sessionId]/route.ts`, `checkpoints/route.ts`; installed `@ai-sdk/harness@1.0.98` checked (`prepareCall` is only invoked on the fresh-prompt path, agent/index.js:4027), `@ai-sdk/harness-codex@1.0.100` (fingerprint = sha256(instructions, tools), excludes `mcpServers`; a skills change also triggers a restart, index.js:617-627 and 1023-1027), `@ai-sdk/sandbox-vercel` (`stop()` on a caller-owned sandbox is a no-op, so no double stop), `@vercel/sandbox@3.2.1` (`Sandbox.get` without `resume` auto-resumes on the first SDK call that needs a session) | `check-native-stream.mjs`, `check-failed-run.mjs` (9 scenarios), `check-gateway-diagnostics.mjs`, `check-workspace-restore.mjs`, `gateway-transport.test.ts` (bounded 429 backoff: 2 retries, ≤60 s, honours Retry-After, never replays an accepted stream); repro (e) | **Partially verified**: streaming/backoff/paired restore/fence logic verified; the real Codex process (`diagnostics/check-hive-tools.mjs`, `check-codex-process.mjs`) not run (needs an isolated SDK install); Vercel's 300 s termination and Sandbox expiry not verified. **Findings P1-2, P2-4, P2-5, P3-6** |
| **D. Live sync / presence / DB / cache cost** | `session-live.ts`, `session-events.ts`, `session-presence.ts`, `live/route.ts`, `use-shared-session.ts`, `use-workspace-read.ts`, `workspace-read-cache.tsx`, `db/index.ts` | Unit tests (live/presence/out-of-order snapshots); `check-shared-session.mjs` (real hook, no HTTP heartbeat, reconnect recovers one message); `pnpm test:session-egress` on real local Postgres plus real WebSockets, 9 checks: typing causes 0 task reads, **31 s idle causes 0 pooled queries and 1 NOTIFY of 185 bytes**, reconnect causes 1 task read of 1483 bytes with private history removed in SQL, revoked member 4401, expired login 4401 | **Verified** (locally). The real cross-instance NOTIFY path (`check-live-transport.ts`) not run. **Findings P2-3, P2-6, P3-8 (authorisation query rate, 270 s reconnect)** |
| **E. Files / Diff / Runs / collaboration UI** | `workspace-files.ts`, `workspace-browser.ts`, `workspace-read-script.ts`, `workspace-file-type.ts`, `code-reference.ts`, `files/route.ts`, `components/hive/*`, `ai-elements/conversation.tsx`, `message.tsx`, `use-message-draft.ts`, `message-draft*.ts`, `message-keyboard.ts` | `workspace-files.test.ts` (the read script executed in a real child process: traversal/symlink/credential files/binary/512 KB/UTF-8/507-entry pagination/shell-like filenames); `check-workspace-files.mjs`, `check-workspace-cache.mjs` (SWR keys isolate task/path/revision, late responses, Monaco remounts), `check-conversation-scroll.mjs`, `check-thread-preview.mjs`, `check-workspace-runs.mjs`, `check-dashboard-preview.mjs`; Streamdown default link policy checked | Core safety boundaries and cache isolation **verified**; no real browser/narrow-viewport/keyboard-focus pass (no browser authorisation). **Findings P2-1, P3-2, P3-3, P3-5, P3-8** |
| **F. Memory / agent tools / untrusted context** | `hive-memory.ts`, `hive-memory-recall.ts`, `hive-mcp.ts`, `hive-tool-context.ts`, `hive-tool-token.ts`, `agent-tools/route.ts`, `SKILL.md` | `check-memory-recall.mjs` (real HarnessAgent lifecycle, 8 checks: one lookup per fresh turn, tool steps/continuations do not re-query, 2 s deadline releases the turn, empty/error/timeout never block, scope filtering, bounded provenance, unsafe queries never leave the host); `hive-mcp.test.ts` (real MCP client/transport); `hive-memory.test.ts`; `hive-tool-token.test.ts` (an invite token cannot act as a tool token and vice versa: HMAC domain prefix `hive-agent-tools:` plus audience); the egress check's real route covers 401/413/retry-safe reply/stale run/revoked member | **Verified** (fixtures). Server-enforced: repo+installation scope, `hive_scope` post-filter, sources limited to existing human messages/replies, 1,000 characters plus obvious-secret rejection, 5-minute task/member/run capability, 16 KB body, idempotent requests, pending is not saved. **Enforced only by skill/model**: `remember_memory` needs "an explicit human request", no repeated lookups, old memories are not instructions, `reply_to_thread` does not claim delivery. Repository content could prompt-inject the model into saving an existing human sentence to shared memory (bounded impact: only existing human text). **Finding P3-4** |
| **G. Test validity / maintenance / commit credibility** | `package.json` scripts, all `*.test.ts` and `scripts/check-*.mjs`, `scripts/diagnostics/*`, `prepare-*.mjs`, `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `drizzle.config.ts`, README/CONTEXT/SETUP/ROADMAP/MEMORY_TRADEOFF/DEMO_BRIEF/STREAMING_DIAGNOSIS/DEVELOPMENT (sampled sections) | See §4 | **Verified**: no skips or false greens in `pnpm test`; the mock/real boundary is honest (each script's header states what is doubled). **Gaps**: `pnpm test` excludes the two real-Postgres integration checks (env-gated), so CI would not run them by default; no concurrency stress test; no real-browser e2e. Documentation inconsistencies in §6 |

---

## 4. Test record

Environment: Node `v25.2.1`, pnpm `11.19.0`, macOS Darwin 25.5.0; a local Homebrew PostgreSQL 18.4 on 127.0.0.1:5432 (used only to create and drop disposable fixture databases).

### Executed in this review

| Command | Result |
| --- | --- |
| `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat`, `git diff --cached --stat` | See the header; HEAD `2799196`, 4 modified docs, 1 untracked handoff |
| `git diff --check` | exit 0, no whitespace problems |
| `pnpm lint` | eslint produced no output, success |
| `pnpm typecheck` | `next typegen` succeeded, `tsc --noEmit` reported no errors |
| `pnpm test` | **exit 0**. `node --test src/lib/*.test.ts`: **150 tests / 150 pass / 0 fail / 0 skipped** (1.29 s); `check-memory-recall.mjs`: **8/8 pass**; the remaining 12 controlled scripts printed **46 PASS lines**, no `not ok`/AssertionError. The `Error: Sandbox unavailable (fixture)` and `Checkpoint unavailable (fixture)` lines in the log are failure paths deliberately injected and asserted by `check-failed-run.mjs` |
| `HIVE_ONBOARDING_TEST_DATABASE_URL=postgresql://spenc@127.0.0.1:5432/postgres pnpm test:onboarding` | **exit 0, 9/9 PASS**; the script created and dropped `hive_onboarding_test_<uuid>`, nothing left in `pg_database` |
| `HIVE_EGRESS_TEST_DATABASE_URL=postgresql://spenc@127.0.0.1:5432/postgres pnpm test:session-egress` | **exit 0, 9/9 PASS**. Measured: typing change `taskReads: 0`; 31 s idle `queries: 0`, `notifications: 1` (185 B); reconnect `taskReads: 1`, `decodedResultBytes: 1483`, no private-history bytes. No leftover database |
| `DATABASE_URL=postgresql://hive_review:unused@127.0.0.1:1/... DATABASE_URL_DIRECT=<same> pnpm exec next build --webpack` | **exit 0**. Database variables were overridden with a dummy loopback URL to isolate production; Next still loaded the other keys from `.env.local` (all read lazily inside functions, unused at build time); the build reaches Google Fonts (`next/font/google`). The output replaced the previous `.next/` (gitignored); BUILD_ID changed from `zQ1L5_3RtMbLktCYLDA96` |
| Local repro script (scratch directory, imports `src/lib/*.ts` only) | (a) reset mid-run: 4→1 messages, queue 1→0, liveReply gone, agentSession replaced; (b) three hours later send/apply/advance still running, restore blocked; (c) a 4,194,304-byte message accepted and starts a run; (d) three time labels for one instant across UTC/LA/NY; (e) a single failed save throws and aborts; (f) attach during planning drops liveReply |

### Not executed and why

- `scripts/diagnostics/check-hive-tools.mjs`, `check-codex-process.mjs`: need an isolated `@openai/codex-sdk@0.149.1` install and a real Codex process; nothing was installed.
- `scripts/diagnostics/check-harness-stream.mjs`, `check-gateway-transport.mjs`: diagnostics outside `pnpm test`; not executed without individual review.
- `scripts/check-live-transport.ts`: needs `DATABASE_URL_DIRECT`; production variables were not reused and no local database was substituted (diagnostic, not a gate).
- `scripts/check-oauth-origin.mjs`: needs a Next server running with fixture credentials.
- Anything live/real: Mem0, models, Vercel, real GitHub accounts, the production database, browser interaction.

### Distinguishing historical evidence

- "125 sandbox-revision unit tests / Exit 0", "158/149/150 unit tests" and the September 6–10 production observations in the docs are historical records, not results of this review. The actual unit-test count of this working tree is **150** (matching `ROADMAP.md` and the September 9 entries in `DEVELOPMENT.md`).
- Every external service was doubled or loopback in this review; the MCP client/transport, the HarnessAgent lifecycle, Postgres and WebSockets were the real implementations.

---

## 5. Minimal fix order

### Must fix for the current release (within the existing scope)

1. **P1-1 Reset**: remove the UI entry, or add confirmation plus a server-side idle gate. Acceptance: reducer test "reset returns the same state while running or with a queue"; route returns 409; component test "click opens confirmation, cancel dispatches nothing".
2. **P1-2 dead-run recovery**: add a member-confirmed "mark run as failed" (or detection by `startedAt` age on read) reusing `applyHiveRunError`, keeping messages/queue. Acceptance: state-machine tests; route boundaries; docs disclose the "5-minute limit and how to recover".
3. **P2-1 time labels**: `ChatMessage.createdAt` plus client-side formatting; remove the hard-coded `America/New_York`. Acceptance: a component test that the three time sources agree; old messages fall back.
4. **P2-2 message limit**: consistent across route/reducer/UI. Acceptance: route 400, reducer ignores, `maxLength`.
5. **§6 doc sync**: memory status in README/SETUP, the "no cross-task memory" wording in DEMO_BRIEF/DEVELOPMENT, whether Reset exists.

### Can follow later

6. P2-4 non-fatal progress checkpoints.
7. P2-3 connection-pool/advisory-lock hold time; Pool `connectionTimeoutMillis`.
8. P2-6 drop `files` contents from the public snapshot.
9. P2-5 a re-clone action after sandbox loss.
10. P3-4 recall field naming plus regression; P3-2 dead code; P3-3 diff line numbers; the remaining P3s.

Do not widen the current release scope (Workflow, PRs, membership management, invitation revocation UI, etc.).

---

## 6. Documentation inconsistencies and remaining manual acceptance

### Documentation inconsistencies (to reconcile by date and fact; not code bugs)

1. **Memory status lags the latest uncommitted evidence**: `README.md:33, 88, 104` and `docs/SETUP.md:21` still say "not yet a verified live capability / acceptance remains pending", while the uncommitted `ROADMAP.md`, `MEMORY_TRADEOFF.md` and `DEVELOPMENT.md` (September 10, 01:12–01:14 UTC) record one real ADD plus a cross-task SEARCH hit and keep three boundaries (source-task citation defect, 429 not permanently resolved, cross-repository isolation untested). README/SETUP should be updated and keep those three boundaries.
2. **"No cross-task memory"**: `docs/DEMO_BRIEF.md:60` and `docs/DEVELOPMENT.md:212` still say the demo has no cross-task memory, but repository-scoped cross-task memory is deployed. If it is deliberately kept out of the demo, say "not demonstrated live"; otherwise this contradicts GOAL.
3. **Reset is acknowledged by no product document**: README/CONTEXT lack the action; `DEMO_BRIEF.md:28` and `ROADMAP.md:47,72` only warn "do not reset to manufacture evidence". Either remove the feature or document its boundary.
4. **Time expressions**: the evidence log mixes UTC/Pacific/EDT while the UI shows server-UTC hours (P2-1). Matching records to the UI during the demo will be confusing.
5. **Truncation caps undocumented**: 12 changed files, 60K diff, 20K command output (`hive-runner.ts:35-37`); README only documents the 512 KB preview limit.
6. **`.env.example`** describes `HIVE_INVITE_SECRET` as signing invite links only; it also signs agent-tool capabilities (SETUP mentions it, the example file does not).
7. **Test counts**: September 9 entries variously say 158, 149 and 150; the current count is 150 and historical entries are dated, which is acceptable, but README's verification section gives no current number.
8. **`ahead 1` note**: the handoff warned the tracking ref might lag; by the end of this review an IDE background fetch confirmed `2799196` is on GitHub, so the docs no longer need to say "not yet live".

### Remaining manual acceptance (not mixed into the bug list)

- A genuinely new GitHub account: first signup → creates its own task → after being invited into someone else's task the repo list reflects only its own permissions (passed locally on real Postgres, not yet in production).
- Live cross-repository memory isolation; re-verification of the source-task citation after the fix (needs one model request with owner approval).
- `.vercel/project.json` and `.env.local` are gitignored. The pattern scan cited by this review reached `ce2741b`; it did not cover later commits or establish a complete security audit.
- Gateway 429: two successes do not mean stable quota; keep live checks bounded, and until P1-2 is fixed document the dead-run recovery boundary.

---

The review stopped here awaiting the owner's decision; no fixes, deployment or live re-tests were started as part of the review itself.

---

## 7. Fix record (2026-09-09 Pacific; done in the same working tree after the owner said to fix; not committed, pushed or deployed)

### Fixed

| Finding | Fix | Location | Regression |
| --- | --- | --- | --- |
| **P1-1 Reset without confirmation, allowed mid-run** | The reducer rejects `reset` when `isHiveRunActive || activeSteer || steeringQueue.length > 0`; the header button is disabled under the same condition and now opens a confirmation dialog stating that the shared conversation is erased for everyone and cannot be undone | `src/lib/task-session.ts` (reset branch), `src/components/hive/hive-workspace.tsx` (`resetDisabled`, `Dialog`) | `task-session.test.ts` "reset needs an idle task…"; the reset case in `task-session-snapshot.test.ts` now finishes the planning turn first |
| **P1-2 dead run with no recovery path** | New `recover-stalled-run` action with `isHiveRunStalled`/`STALLED_RUN_AFTER_MS = 6 min` (the route's 300 s `maxDuration` plus grace); the server accepts it only past the threshold and reuses `applyHiveRunError`, keeping messages, the partial reply, the queue and the agent session; the UI shows "Mark run as lost" once the threshold passes (`useStalledRun`, 5 s client polling, false during SSR); the error copy maps to a dedicated lost-run explanation | `task-session.ts`, `route.ts` (allow-list), `hive-workspace.tsx`, `src/hooks/use-stalled-run.ts`, `hive-error-copy.ts` | `task-session.test.ts` "a run that outlives its request…"; `hive-error-copy.test.ts` |
| **P2-1 time-label time zone** | `ChatMessage.createdAt` (epoch) is written at every message creation point; the client `MessageTime` renders it with `Intl.DateTimeFormat` in the viewer's zone (`suppressHydrationWarning`), old messages fall back to `time`; the restore message no longer hard-codes `America/New_York` | `task-session.ts`, `workspace-restore-state.ts`, `src/lib/message-time.ts`, `src/components/hive/message-time.tsx`, `hive-workspace.tsx`, `message-thread.tsx` | `message-time.test.ts`; `task-session.test.ts` "…machine timestamp…" |
| **P2-2 unbounded message body** | `MESSAGE_BODY_LIMIT = 8_000`: the route returns 400, the reducer ignores, the main composer sets `maxLength` | `task-session.ts`, `route.ts`, `hive-workspace.tsx` | `task-session.test.ts` "oversized conversation messages…" |
| **P2-4 one failed checkpoint save aborted the turn** | `createReplyWriter` is now best effort: failures are reported through `onSaveError` (the route logs them), `push` no longer throws, the next delta tries again, `close()` returns `{ delivered }` and never throws; `finishAgentReply` prefers the completed text (`body || liveReply.body`) so a lagging checkpoint cannot overwrite the final reply | `agent-stream.ts`, `route.ts`, `task-session.ts` | two new cases in `agent-stream.test.ts`; "refresh restores…" now expects the final text to win |
| **P3-3 Diff line numbers** | New `annotateUnifiedDiff`; the Diff pane shows real old/new file line numbers, with headers/hunk markers/truncation notices as meta | `src/lib/diff-lines.ts`, `diff-pane.tsx` | `diff-lines.test.ts` |
| **P3-4 recall provenance fields** | Prompt fields renamed to `sourceTaskId/sourceMessageId/sourceReplyId`, with a one-sentence field description and an instruction to cite the task by `sourceTaskId` | `hive-memory-recall.ts` | new assertions in `scripts/check-memory-recall.mjs` |
| **§6 documentation inconsistencies** | README (memory status, Reset/lost-run/limits/time zone/truncation caps), SETUP, DEMO_BRIEF, DEVELOPMENT (capability boundaries and dated evidence), CONTEXT (Run entry), `.env.example` (`HIVE_INVITE_SECRET` also signs tool capabilities) | see `git diff --stat` | manual check |

### Not fixed (kept in §2; need design or larger changes)

P2-3 (Files reads holding pool connections/advisory lock), P2-5 (re-clone path after sandbox loss), P2-6 (public snapshot carrying `files` contents), P3-1 (invitation-link semantics), P3-2 (`steer-agent`/`AnnotationCard` dead code), P3-5/6/7/8. P3-7 still reproduces after the fixes (a planning reply is dropped when a repository is attached mid-turn).

### Post-fix verification (local, 2026-09-09 Pacific)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Pass (one TS18047 appeared first; fixed the null narrowing in `use-stalled-run.ts`, then pass) |
| `pnpm lint` | Pass |
| `pnpm test` | **exit 0**: unit **161/161** (11 new), recall 8/8, 46 controlled PASS lines |
| `pnpm test:onboarding` (disposable loopback DB) | 9/9 PASS, no leftover database |
| `pnpm test:session-egress` (disposable loopback DB) | 9/9 PASS; 31 s idle still 0 pooled queries |
| `next build --webpack` (dummy `DATABASE_URL` isolation) | Pass |
| `git diff --check` | Pass |
| Repro script (rewritten to assert the fixed behaviour) | (a) reset mid-run rejected, conversation/queue intact; (b) rejected before the threshold, after it the run ends, the queue is kept and restore is unblocked; (c) an 8,001-character message is ignored; (d) the same `createdAt` renders 6:52 PM in UTC and 11:52 AM in LA; (e) with a permanently failing checkpoint store the turn still completes with `delivered: false`; (f) the deferred item still reproduces |

### Behaviour changes to note (for the owner)

- Reset now requires confirmation and is unavailable while a run is active, a steer is applied or the queue is non-empty.
- A run that has not reported for six minutes shows "Mark run as lost"; it marks the run as an error and keeps everything, without rerunning.
- The final text of a streamed reply is the model's completed text (previously the last successful checkpoint).
- New messages show the viewer's local time; historical messages keep their old server-zone labels.
- All of the above is local verification only; deployment and live re-tests remain the owner's decision.
