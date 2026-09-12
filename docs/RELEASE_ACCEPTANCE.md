# Hive — full release acceptance script

Prepared September 12, 2026 against main `f1da1048b01c49ef73cddd9ed4dddc92bce6b90e` (PRs #4 and #5 merged). This is an execution script, **not a record that these cases passed**. Rebind the run to the actual production commit before starting. Historical evidence does not pre-fill this run.

## Current execution priority: user experience

The current run prioritizes real user journeys, per the product owner's request: start a task, talk to Hive, discuss in a Thread, answer a question, inspect/review changes, restore work, and archive/restore a task. Judge discoverability, clarity, response placement, waiting feedback, draft preservation and the ability to continue working—not merely successful requests.

Security-specific probes (anonymous/authenticated endpoint replay, tampered invitations, cross-repository attacks) are deferred, not release blockers for this UX run and not marked passed. Exercise ordinary invitations and designated-answer behavior as user-facing interactions. Exhaustive model/effort benchmarking, fault injection and infrastructure qualification remain separate from the core UX verdict. Document unavailable accounts or runtime credentials without stopping unrelated journeys.

| Journey | Test purpose | Existing case references |
| --- | --- | --- |
| Enter and start | Reach a usable conversation without unnecessary setup, greeting or title form; find Demo and invite teammates naturally. | E01, E03–E06, E08 |
| Converse with Hive | Get one appropriately sized response, understand running/error states, and retain selected model and context. | A01–A05 |
| Edit and queue | Correct text without losing drafts/discussion or accidentally executing new work; see exactly what will run next. | M01–M08 |
| Discuss in Thread | Keep one coherent discussion; ordinary replies remain discussion, explicit steering produces a response in that Thread. | T01–T02 |
| Answer a question | Know who should answer and where; one answer resumes work once without duplicate cards or forced navigation. | Q01–Q05 |
| Inspect and review | Find actual changes and evidence, leave useful feedback, and separate navigation from deliberate verification. | W01–W02, R01–R03 |
| Restore and reconnect | Understand what is restored, see bounded progress, retain discussion and regain a usable composer. | S01–S06 |
| Archive and return | Put a shared task away without losing it, see a clear read-only state, and restore it without starting the Agent. | G01–G02 |
| Memory and delegation | Understand genuine saved/retrieved context and real child status; never present placeholders as completed work. | O01–O05 |
| Layout and consistency | Complete the same journeys at different widths with consistent Demo/production widgets and reachable controls. | U01–U03 |

## 0. Run header and rules

Create a private run record with these fields:

```text
Run ID: YYYYMMDD-HHmm
Production origin: https://hive-roan-mu.vercel.app
Git commit / Vercel deployment / alias verified at:
Browser versions / viewport sizes:
A: Spinsirr, browser profile:
B: josephmreb1, separate browser profile:
C: signed-in nonmember / genuinely new account, if available:
Repository R1 / optional distinct repository R2:
QA task URLs (never include invitation tokens):
Native runtime / exact model / effort for each task:
Case | Test purpose | PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE/DEFERRED | observed result | evidence | defect
```

- Start every case as `NOT_RUN`. Missing login, credentials, a second repository or fault reproduction is `BLOCKED`, not a pass. Use `NOT_APPLICABLE` only when the deployed product does not advertise that capability, with a reason.
- Record whether one supervisor operated both accounts; do not call this independent human review. A returning account is not a first-signup test.
- Use new `QA <Run ID> — …` tasks. All file changes stay in their isolated Sandbox working copies. No commits, pushes, PR creation/merge, resets of existing tasks, secret rotation, billing changes or destructive database commands.
- Ordinary observation/refresh, invalid input, duplicate submissions, deliberate edits and queue actions are in scope. Do not manufacture failures by damaging production infrastructure. Worker/Sandbox destruction and credential revocation require a separate controlled test environment.
- For each real run, record the prompt, author, start/end, one observed result, and relevant Runs/tool evidence. A UI row or successful HTTP status alone does not prove an Agent executed a tool.
- Record model errors once with a redacted request/run ID. Stop that case on quota/auth failure; do not upgrade billing, silently switch provider, or repeatedly retry it into a pass.
- Keep tokens, cookies, authorization URLs, invitation URLs, environment values and private repository content out of screenshots, committed reports and public issues.
- A bug is `FAIL`: fix it, deploy the fix if authorized, and repeat the failing case plus its affected flow. Record the new commit. Do not combine results from different commits into an unlabeled “all green”.

## 1. Local regression gate (no production credentials)

Use the repository's pinned pnpm and preferably Node 24, matching CI. A loopback server must be a disposable local Postgres, **not a tunnel to production**. Its role needs `CREATE DATABASE`; fixture suites own and remove uniquely named databases. Live transport uses transient `NOTIFY`, not application row mutations.

```bash
pnpm install --frozen-lockfile
pnpm test:release --plan
HIVE_QA_DATABASE_URL=postgres://localhost/postgres pnpm test:release
```

The runner executes lint, shared-UI ownership, types, the complete default suite, integration, peer-store and build in order. Each stage has a 15-minute limit. Results and logs go to a new private temporary directory printed by the command. A failed stage makes the run fail even if subsequent stages pass. Interrupted/unreached stages are not successes. Inspect and copy the report to the private run record before temporary-file cleanup.

Local passes cover real Postgres, real local transport and controlled service boundaries. They do **not** prove production GitHub login, provider availability, real tool use, native recovery or Mem0 Cloud behavior. Record runtime differences and dirty source files; clean Node-24 CI remains a separate gate.

## 2. Entry, identity and task isolation

| ID | Execute | Required observation |
| --- | --- | --- |
| E01 | Anonymous browser: open home → Demo → each sample task → back. | Visible Demo entry; every task opens; shared production widgets; sample label; no real task/model call. No redundant collaboration banner. |
| E02 | Anonymous browser: open a new QA task URL without its invitation; request its known session/files/checkpoints/live endpoints without credentials. | No private title, messages, files or native context; access/login denial, not an empty-looking authorized workspace. |
| E03 | Genuinely new GitHub account C: login → dashboard → New task. | No invitation needed to create own task; empty private list; direct empty conversation without greeting or forced title form. If C unavailable, mark blocked. |
| E04 | A: New task → send `hi` once. | One short real reply; no skill lecture, repository scan, question, separate Thread or unsolicited code work. First message names task once. |
| E05 | Rename the task, reload, open the saved URL from another tab. | Same URL/messages/Thread/run history; shared new title; no new Agent run. Cancel/blank/oversized name never saves. |
| E06 | Before invitation, B opens A's QA task directly; then A copies Invite and B joins using it. Test a one-character-tampered copy separately before joining a different QA task. | B denied before a valid invite, admitted once after it; repeated valid join does not duplicate membership. Tampered invite denied. Actual expiry is a separate case if an expired test link exists. |
| E07 | C or B-before-join tries the other known QA task's read/write/files/checkpoints/subagents endpoints; A and B each inspect their repository chooser. | Signed-in nonmembership denied; invitations grant this task, not unrelated tasks or the inviter's entire repository list. No credentials/private harness context in public responses. |
| E08 | A attaches authorized R1; exercise GitHub reconnect if expired. B tries its own inaccessible repository through normal available controls. | Listing/attach follows signed-in GitHub access intersected with installed App access; no silent attachment to a different repo. Existing attached repo cannot be replaced. |

Negative authenticated API checks use only the QA identities and task IDs, through a scoped test client or browser developer tools. Never copy production cookies into a source file or use a generic replay against real user tasks. UI-hidden controls alone are not proof of server-side denial.

## 3. Real Agent, model controls and saved context

Create a fresh task for each runtime/model so existing native history is not silently switched. Enumerate the **actually displayed** model/effort combinations; do not import Codex Desktop capabilities as Hive's contract.

| ID | Execute | Required observation |
| --- | --- | --- |
| A01 | For each advertised model, select it and send `Reply with exactly MODEL_OK. Do not use tools.` at its lowest supported effort, then repeat at its highest. | One real answer per request; selected native model/effort is verified in run metadata/provider evidence, not merely a dropdown. Capture auth/quota failures as failures or blockers. |
| A02 | Inspect intermediate effort choices, keyboard navigation, menu closing, mobile endpoints, busy/history locking, and a model with no effort choices. | Only supported values; no clipped knob/menu; correct shared value after refresh. A no-effort model sends no invented Low. Do not claim untested middle values executed. |
| A03 | In a fresh Codex R1 task and a fresh Claude R1 task, run the coding prompt below, then a separate continuation. | Actual file and successful assertion in Files/Diff/Runs; real command exit code; second turn preserves native context and workspace without duplicate public replies. |
| A04 | Refresh B while A's real response is streaming; reconnect A during deltas. | Incremental text merges into one final response, not duplicate turn/Thread entries; final body persists on both. Temporary Syncing is not permanent composer lock. |
| A05 | User/Agent mentions, newline, CJK IME, Ctrl/Cmd shortcuts and empty submit on main composer. Double-submit once in the QA task. | Correct literal text and author; composition Enter does not send; one accepted message/run; draft retained on unconfirmed delivery. No queued input leaks into the active run. |

Coding prompt (substitute `<RUN_ID>` and `<FILE>` with a unique `hive-qa-<RUN_ID>.txt` path):

```text
This is an isolated QA task. Create only <FILE> at the repository root with:
HIVE_RELEASE_QA
marker=ALPHA
Run a Node assertion that reads this exact file and checks both lines, then run
git diff --check. Show the actual results. Do not commit, push, open a PR,
install dependencies, alter any other file, or write memory.
```

Continuation:

```text
In the file created in your previous turn, change only marker=ALPHA to
marker=BETA. Verify its contents with Node and git diff --check. Do not ask me
for the filename, modify other files, commit, push, or create a PR.
```

## 4. Message editing and queue (real runs, A + B)

| ID | Execute | Required observation |
| --- | --- | --- |
| M01 | A sends `Reply exactly ORIGINAL_ACK. No tools.`; wait for completion. B replies to that human message's Thread. A leaves an unsent composer draft, then edits the parent in place. | Original author/ID/time/order and B's Thread retained; main draft untouched; Edited/history available; B sees update live and after reload. Exactly one ORIGINAL_ACK; editing starts nothing. |
| M02 | B opens A's message actions; inspect Agent output, code quote and restore receipt actions. Attempt a scoped nonauthor edit against the QA task API. | Edit absent where disallowed and server rejects unauthorized edit; audit/evidence messages remain immutable. |
| M03 | A edits multiline/CJK text; try Escape, Cancel, whitespace-only and 8,001 characters. | Explicit save only; correct caret/focus return; validation; no silent truncation or empty save. Failed save retains draft. |
| M04 | Two A windows open the same revision. Save one, then save different text in the stale window. | Second gets conflict; no overwrite; stale draft remains; connection stays live. Reopen editor gets newest version. |
| M05 | During a real longer response, queue `Reply exactly QUEUE_OLD. No tools.` and `Reply exactly REMOVED_SHOULD_NOT_RUN. No tools.` Edit first to `Reply exactly QUEUE_EDITED_ACK. No tools.` | Same queue item/position with new content; both viewers see it; current run is not restarted/interrupted. Run next is unavailable while running. |
| M06 | Move second item up/down, then Remove from queue. After current run, use Run next. | Order syncs; removed message remains discussion; exactly one QUEUE_EDITED_ACK and zero removed-request replies; queue clears and controls unlock. |
| M07 | Open a queued editor in A; have B dispatch/remove that queue item; A saves its old draft. | Visible conflict and retained draft, not a silent rewrite of already-dispatched input. |
| M08 | Queue a whole Thread while another run is active; then edit its parent/add a later reply. Apply it. | Agent receives the captured Thread boundary and attribution, not later edits/replies. No individual-reply steer controls or independent Thread subagent. |

For M05, use a bounded real explanation request (for example 600 words about FIFO ordering, no tools) to create a queue window. If it ends before the interactions, the run did not test busy behavior; repeat once with a fresh bounded window and record it. Do not simulate a running flag.

## 5. Thread conversation and structured questions

| ID | Execute | Required observation |
| --- | --- | --- |
| T01 | B opens Thread on a human message, then an Agent message; sends ordinary replies and mentions. | Same body/footer design with/without tool calls; exactly one entry per Thread; counts/excerpt correct; authors preserved. Discussion alone does not wake Hive. Copy copies text, not approval or Thread data. |
| T02 | Click Steer thread (or Queue thread during a run). | One real main-agent turn, reply streamed and saved inside that originating Thread, not repeated in main. Later unsteered discussion is excluded. |
| Q01 | A sends the question prompt below. B answers once while A observes. | One inline question addressed to B, no mandatory Thread; A cannot answer. One attributed answer and one automatic continuation using saved history. No repeated tool wakeups/question cards. |
| Q02 | B double-clicks/answers from two tabs; also test a pending question without a designated member where A/B race. | First eligible answer wins once; later attempt cannot overwrite; only one execution grant/continuation. UI and reload agree. |
| Q03 | Agent asks while still doing independent work; B answers before run ends. | Answer queues without interrupting active run, then continues once at its safe boundary. Two observing browsers do not double-start it. |
| Q04 | Repeat with all viewers closed after the answer is stored, then reopen. | Saved answer/queue survives. No promise of a durable background continuation; reconnect can continue once, not issue a new question. |
| Q05 | Ask Hive to request a decision from inside an explicitly steered Thread; B answers there. | Question, answer and resumed response remain in that same Thread; no extra top-level question or duplicate Thread entry. |

Question prompt:

```text
Ask @josephmreb1 exactly once, using the structured question tool, which marker
to use: ALPHA or BETA. Use one stable request key qa-<RUN_ID>-marker. Do not
answer on their behalf, poll for a response, repeat the question, or change
files. After their actual answer is delivered, reply exactly CHOSEN=<answer>
and stop. Do not open a separate discussion Thread just to ask this question.
```

## 6. Workspace, code annotations and review

Use the real changed file from A03, not a Demo diff.

| ID | Execute | Required observation |
| --- | --- | --- |
| W01 | Both accounts inspect Diff, complete Files tree, file contents, Runs command output and Checkpoints; reload and resize. | Actual file/line/content evidence; on-demand reads; meaningful empty/loading/failure states, not a blank pane. Only this task's files. |
| W02 | B selects exact lines and comments; open the resulting discussion, then explicitly steer it. | Immutable file/path/line quote; no file edit/model call before steer; one returned response in the correct Thread. |
| R01 | Ask Hive to request B's review of the exact current change with a stable `qa-<RUN_ID>-review` key. Open review → View changes → Files/Runs → Back to review. | Review is bound to saved completed-run evidence; navigation never verifies/approves. No global Approve changes button. Return to the same Thread. |
| R02 | B adds feedback and steers it; inspect Agent revision; B explicitly uses Verify & resolve. | Feedback must be addressed; only eligible reviewer can verify the displayed current revision; one recorded verification; no GitHub merge or task closure. |
| R03 | Leave review open in B, then A changes the file in another real turn or restores an earlier checkpoint; B attempts old verification. | Stale revision rejected/disabled; new comments and workspace changes invalidate readiness. Opening Diff alone cannot satisfy feedback resolution. |

## 7. Restore, reconnect and team archive

Use one task with confirmed ALPHA and BETA checkpoints. Record both checkpoint IDs, actual file contents and native context evidence before starting. Do not use Reset as a substitute for restore.

| ID | Execute | Required observation |
| --- | --- | --- |
| S01 | Open Restore confirmation and Cancel. | No workspace/context/state change. The dialog states what will and will not be restored. |
| S02 | While idle, restore ALPHA; have both accounts observe, including a reload during recovery. | Exactly one restore; writes fenced only while unconfirmed; final Files shows ALPHA, selected checkpoint context paired correctly, review invalidated, discussion retained, no automatic run. Banner/dialog settle and composer re-enables. |
| S03 | A and B both confirm the same restore near-simultaneously. | One effective restore/receipt; no newer attempt completed by a late response; no duplicated operations. |
| S04 | Restore with queued input and reopen the task. | Queue retained but not auto-run. Explicit Run next resumes once from restored files/context. Historical restore receipt is not editable. |
| S05 | Observe a real timeout/interrupted response in a disposable QA recovery, if it occurs. | Bounded status checks, elapsed time and same-checkpoint retry; closing modal does not cancel/replay. No indefinite Restoring or stale disabled input after confirmation. If not reproduced, mark NOT_RUN; local race fixtures are separate evidence. |
| S06 | Browser loses connectivity during deltas/saving; reconnect. | Saved partial/final state restored without duplicate delivery; unconfirmed draft retained; wrong/stale snapshots do not overwrite new state. Network disconnection is not a hard worker crash test. |
| G01 | Attempt archive while run/queue/recovery active, then archive when idle. | Busy operation blocked; idle archive moves task for everyone, preserving all data. No Agent starts. |
| G02 | B refreshes archived task and tries message/edit/reply/question/review/steer/repo attach/checkpoint restore, including a stale open editor. | Reads work, every write rejected; not just a hidden composer. A/B can restore the team archive, after which normal controls work without automatic execution. |

Do not label hard-worker death, deleted Sandbox recovery, or permanent provider outage as supported/pass based on these tests. They are distinct operating limits in [the scope document](ROADMAP.md).

## 8. Memory and native subagents

These are separate live acceptance rows, not inferred from a normal reply or local SDK fixtures.

| ID | Execute | Required observation |
| --- | --- | --- |
| O01 | In an isolated R1 QA task, explicitly ask to remember one harmless, unique human contribution: `QA <RUN_ID> only: marker <RANDOM_VALUE>; not a product convention.` | One confirmed Mem0 write with exact text and source author/task/message/reply IDs; pending/error is not saved. No full transcript or secret uploaded. Record the resulting test-memory ID privately. |
| O02 | New task on R1: ask for the marker for `QA <RUN_ID>` without including `<RANDOM_VALUE>` or source IDs. | Actual retrieval and correct value/provenance. Distinguish automatic recall from an explicit search tool; provider/tool evidence must show which occurred. |
| O03 | New task on distinct R2: ask the same question without the answer. | R1 memory is absent; no cross-repository result. Missing R2 makes this blocked, not passed. Do not reuse the same native session for this test. |
| O04 | On a runtime advertising subagent tools, explicitly request one short research child and one review child in the existing QA Sandbox, no changes or further delegation. | Real child start/status/result, inherited task context/model/settings, distinct assignment, one parent; persisted result after reload; not a simulated row. |
| O05 | B stops a still-running child; inspect parent and queue. | Stop applies only to that child; Stopping becomes Stopped only on confirmation, otherwise honest Unconfirmed. Parent and queued work retained. No independent Thread agent introduced. |

Archiving tasks does not delete Mem0. Do not silently purge test memory; record it for explicitly authorized cleanup. Do not change provider keys or quota to force a passing result. Claude lacking Codex-only child controls is an explicit capability difference, not a reason to fake a child run.

## 9. UI and final release verdict

| ID | Execute | Required observation |
| --- | --- | --- |
| U01 | Desktop wide/narrow and 390px mobile: conversation + Thread, model menus, inline edit, queue, question, review, Diff and restore dialog. | No horizontal overflow/overlap; accessible labels; keyboard/touch reachable actions; no accidental submission or review confirmation. |
| U02 | Compare Demo and production widgets while exercising matching states. | Same components and interaction semantics; Demo clearly simulated and isolated, no production writes. Do not count Demo as live acceptance. |
| U03 | Final reload of every QA task in A/B; inspect errors and persisted results. | No ghost typing/duplicate Thread, repeated Agent output, stuck busy/restore state or lost draft; timestamps stabilize in local timezone. No unexpected client/server errors or leaked tokens. |

Finish with one row per case/subcase and per tested model/effort. Attach the local report, CI link, production commit/deployment, QA task URLs, redacted failure IDs and reproduction steps. No blanket “full pass” while required rows are `FAIL`, `BLOCKED` or `NOT_RUN`. Distinguish **core flow passed** from **all advertised capabilities passed**.

Leave QA tasks clearly named. Archive only when idle and when cleanup is part of the run; do not delete conversations or reset shared work merely to tidy the dashboard. Keep one representative task available for inspection. Do not commit private run artifacts to this repository.
