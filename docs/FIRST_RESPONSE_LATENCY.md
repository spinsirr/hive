# First visible response latency — 2026-09-12

## Purpose and production baseline

Measure the wait from clicking Send to the first actual Hive reply, excluding
the working indicator. Use the real deployed app, shared ChatGPT subscription,
Codex / GPT-5.6 Luna / Low, and an isolated QA task. No tool use, repository
reads or file changes were requested. This is not a Demo timing test.

Deployment: `dpl_2EDZUVfHReX16LtmxhzKRRvx6qwE`, commit `8a19d7c`.
Task: [QA 0912 — first response latency](https://hive-roan-mu.vercel.app/sessions/task-k5yl58).
The task was archived after all four responses completed; its history is
recoverable and its repository has no diff. Production logs confirm zero tool
calls in both repository turns.

Browser observations sampled rendered reply paragraphs approximately every
300 ms. The bounds below are the last empty and first nonempty observations,
not provider token timestamps or aggregate percentiles.

| Case | Send time (UTC, September 13) | First visible reply |
| --- | --- | --- |
| New task, no repository, short greeting | 02:53:08.423 | 23.242–23.552 s |
| Same task, no repository, explain a Git branch | 02:54:06.308 | 21.359–21.668 s |
| First turn after connecting `spinsirr/hive`, explain git status | 02:57:28.095 | 35.530–69.101 s; observer gap, **not** an exact measurement |
| Warm repository turn, explain git diff | 02:59:50.863 | 17.595–17.900 s |

The working indicator appeared around 0.9–1.2 s on the first turn. It was not
counted as a reply. These samples confirm the reported delay, not a latency SLA.

## No-repository cause and local change

`runHivePlanningHarness` created a raw `Sandbox` before wrapping it in
`createVercelSandbox({ sandbox })`. That is the SDK's caller-owned path: it
installs the native bootstrap into a fresh VM on **every** no-repository turn.
Even the second message pays the setup cost.

Pass create settings directly to `createVercelSandbox` instead. The installed
Harness/Sandbox provider already hashes the bootstrap recipe, prepares a named
template once, and forks a separate ephemeral VM for each turn. `session.stop()`
owns cleanup on this path; the SDK handles failed startup cleanup.

Only static runtime assets and dependencies enter the template. Subscription
egress rules, run-scoped MCP configuration and user prompts are applied after
the template is frozen. Chat history and task files are not shared across VMs.
The existing persistent repository workspace and native resume path are unchanged.

## Real startup isolation test

`scripts/diagnostics/check-planning-startup.mjs --live` uses real Vercel
Sandboxes, the installed Harness and Hive's actual Codex bridge. It calls
`createSession`, **never** `stream`: no model credentials or inference calls.
Supply `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` for the authorized
test project. The script creates uniquely named test infrastructure, removes
its VMs/template/orphan snapshots, and prints only timing metadata.

One complete comparison on September 13 UTC:

| Startup path | Bootstrap ready | Agent ready |
| --- | --- | --- |
| Old cold-per-turn path | 10.456 s | 12.796 s |
| New path, first template creation | 17.869 s | 19.826 s |
| New path, cached template | 1.966 s | 3.940 s |
| New path, cached template again | 1.311 s | 3.619 s |

Two earlier uncached measurements were 13.306 s and 15.127 s. Their cache
comparisons did not run because the diagnostic initially requested an invalid
one-hour snapshot expiration; that diagnostic-only override was removed.
All created test VMs were cleaned up; neither failed attempt created a template.

The measured saving is **8.9–9.2 seconds of startup** in the complete comparison,
not a measured reduction of production end-to-end TTFT. The first request for a
new bootstrap identity pays template creation; subsequent requests benefit.

A second complete run added a per-turn marker/isolation assertion and a fresh
Node process (empty in-memory cache): uncached **15.817 s**, template creation
**19.623 s**, cached repeats **5.066 / 5.080 s**, fresh-process template reuse
**8.117 s**. All isolated-file assertions passed, and all diagnostic VMs and
the template were removed. This proves reuse survives a process boundary;
it does not make a new server process as fast as a warm one. Across these
samples, cached startup is **3.6–5.1 s warm / 8.1 s in a fresh process**.

## Verification and remaining boundary

- The existing planning/subscription regression failed before the fix when it
  detected manual cold VM creation, and passes after the change. It still checks
  both runtimes, selected model/effort, streaming, cleanup and no Gateway fallback.
- Full `pnpm test`, `pnpm test:auth` with disposable local Postgres, lint,
  typecheck, design-system guard and a production build passed. The build used
  a loopback database URL, not production credentials. Its existing dynamic-file
  tracing warning in `codex-harness.ts` remains.
- The startup test is real infrastructure, but is not a model, collaboration
  tool or user-facing production test of the changed code.
- **Not deployed or pushed in this turn.** Repeat the no-repository production
  test after release, including the first request and cached repeats.
- The planning-only change does not address the warm repository delay. The
  follow-up diagnosis below locates a separate native transport problem.

## Warm repository diagnosis: repeated WebSocket failures

Follow-up inspection used the **same real production turn**, not another model
call or a mocked transport. Vercel request logs and the stopped QA sandbox's
native logs/rollout metadata were correlated with the browser observations.
The CLI's flattened logs omit individual timestamps; the underlying read-only
request-log response retains them.

Request: `n7ngf-1789268391032-1494196c7885`, region `iad1`, function start type
**hot**. Run: `agent-6b550944-88c7-4a13-860e-7c8d1a116ed9`, zero tool calls.

| Milestone (UTC, September 13) | Time | Since Send |
| --- | --- | --- |
| Browser Send | 02:59:50.863 | 0 |
| Request received | 02:59:51.032 | 0.169 s |
| Subscription login/check completed; routing logged | 02:59:57.535 | 6.672 s |
| Native user message prepared | 02:59:58.549 | 7.686 s |
| First main-request WebSocket failure | 02:59:58.942 | 8.079 s |
| Sixth main-request failure; HTTP fallback logged | 03:00:06.866 | 16.003 s |
| Browser first visible text | 03:00:08.458–08.763 | 17.595–17.900 s |
| Native final reply persisted | 03:00:08.833 | 17.970 s |

There was also a failed WebSocket prewarm at 02:59:58.355. The main request
then made six failed attempts, with five backoffs of **202, 389, 730, 1463 and
3163 ms**. Native errors all reported `Attack attempt detected`, followed by
`falling back to HTTP`. The main-request transport phase wasted approximately
**8.3 seconds** before fallback; visible text followed about **1.6–1.9 seconds**
later. The latter includes HTTP/model response and browser delivery, not
model-only latency. The error text alone does **not** establish an actual attack,
expired subscription, or a specific HTTP authorization status. The exact
lower-level handshake rejection mechanism is not identified by these logs.

### Integration mismatch

- `src/lib/codex-subscription-broker.ts` injects real subscription credentials
  through Sandbox outbound request transformations. Native Codex receives an
  unauthentic placeholder, not the real access token.
- The installed `@ai-sdk/harness-codex/src/codex-harness.ts` explicitly notes that
  these transformations apply only to HTTP traffic. Its brokered direct-API
  path selects a provider with WebSockets disabled.
- Hive's `src/lib/codex-bridge/app-server.mjs` instead selects the built-in
  `openai` provider for subscriptions, bypassing that branch. Only the
  non-subscription branch sets `supports_websockets: false`.
- Hive launches a fresh native process each turn. A warm workspace does not
  mean the process remembers the previous HTTP fallback.

The **confirmed latency cause** is the failed WebSocket/retry sequence. The
HTTP-only credential-brokering mismatch is the code-backed explanation to test
when correcting transport selection, not proof of a particular handshake error.
The repair direction is HTTP streaming from the start for brokered subscriptions,
preserving subscription authentication and streaming. Do not copy direct-API
authentication blindly, expose real credentials inside the VM, or switch billing,
model or effort to mask the delay.

### Other hypotheses and remaining costs

- The function was hot: this is not a serverless cold start. The first **6.7 s**
  still include workspace/native preparation and subscription checks; removing
  WebSocket retries will not eliminate these costs.
- The three MCP handshake HTTP responses took **23–78 ms** each, within about
  155 ms overall. A native MCP retry warning occurs during preparation, but
  does not explain the eight-second transport stall. Background function
  lifetime must not be mistaken for HTTP response latency.
- Warm dependency checks took about 368 ms and repository checks 4–13 ms.
  This turn did not reinstall the native runtime or execute any model tools.
- Browser text appeared before native finalization. Later diff/snapshot cleanup
  contributes to request duration, not first visible response.

### Reproduce the forensic check

With authorized `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` set:

```sh
node scripts/diagnostics/inspect-qa-latency.mjs --live \
  snap_eO2cBQCY403AdqKr4e7oqrOsnAm5 \
  --since 2026-09-13T02:59:45Z --until 2026-09-13T03:00:10Z \
  --assert-http-only
```

This creates a uniquely named **copy** of that QA snapshot, opens native logs
read-only, prints safelisted transport/timing metadata, then deletes only its own
copy. No original task resume, model call, credential output, prompt text or
private reasoning is involved. The command was run and the optional assertion
failed as expected: **7 !== 0**, including prewarm. Cleanup completed before the
assertion. Script syntax, targeted ESLint and `git diff --check` passed.
It is a forensic check,
**not** a production acceptance test of a future fix; that requires a fresh real
request and its own snapshot/time interval.

**This follow-up diagnosed the transport issue; it did not change application
code or deploy a transport fix.** Keep the earlier local planning-cache work
separate and verify both with fresh production measurements after release.

## Transport fix and release verification

Following the user's release request, the subscription bridge now selects a
dedicated `hive_chatgpt` provider pointing at the same ChatGPT subscription
endpoint, with `requires_openai_auth: true` and `supports_websockets: false`.
Authentication still uses the native login/check flow and Sandbox credential
brokering. No API key, model/effort change or credential exposure is involved.
These provider fields are documented in the [official configuration reference](https://developers.openai.com/codex/config-reference).
The pinned native version rejects overriding the reserved `openai` provider ID,
so the dedicated provider is required; its native start/resume behavior is tested.

`scripts/diagnostics/check-codex-http-process.mjs <isolated-codex-install>` runs
the pinned Codex 0.149.1 and actual Hive bridge against a loopback HTTP streaming
endpoint with fabricated auth. Before the fix, it failed with **7 !== 0**
WebSocket attempts. Afterward, both new and resumed native turns pass with zero
upgrades, one inference request per turn, and streamed text before completion.
The companion native refresh test also passes background-401, inference-401,
and combined-401 cases: unrelated refresh failures do not break valid replies;
real inference authorization failures still fail closed. All 24 auth-boundary
regressions pass. This controlled-endpoint test supports, but does not replace,
the real post-deployment browser/model verification.

The complete local release gate passed: lint, shared UI ownership, types, default
regressions, disposable-Postgres integration, peer store and production build.
The local runner used Node 25.2.1; clean Node-24 CI is a separate release gate.
Deployment identity and fresh production measurements will be recorded on the
release PR after deployment; these local results are not production evidence.
