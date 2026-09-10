# Post-review verification — September 9 Pacific / September 10 UTC

Initial tested revision: `30f692e626c2a3de75645566ace2c286f84456f7` (Fable's pushed review fixes). The existing deployment was tested; that verification made no runtime changes, commits, pushes or deployments.

**Latest status:** the owner subsequently requested the timestamp fix. The [local follow-up](#follow-up-local-timestamp-fix) now passes the original reproduction and the full test suite. It has not been deployed or rechecked on production. The results below retain the original test round's findings.

## Result

| Check | Result | Boundary |
| --- | --- | --- |
| Existing full suite | Pass: 161 unit tests, 8 recall checks and the remaining controlled regressions | Does not include the new standalone hydration reproduction below |
| Typecheck and lint | Pass | Current local revision |
| Lost-run recovery | Pass against actual local Postgres, routes and store | Controlled fixture state, not a killed production worker |
| Live Reset | Confirmation and cancellation pass; disabled during a real run | No live task was reset |
| Live automatic memory recall and source citation | Pass in a new task with no previous answer | One bounded successful round; cross-repository isolation not tested live |
| Refreshed message times | **Fail** in production and actual React hydration | Reproduction retained; no implementation fix in this verification |

The baseline being green does **not** make this an all-green acceptance result.

## Lost-run recovery: real database integration

New standalone regression: `scripts/check-stalled-run.mjs`.

The test creates a uniquely named disposable database on an existing loopback-only Postgres server, runs the real schema and uses the real authentication, session route and store. It does not load production environment files. Outbound requests and agent execution are forbidden by test spies.

Verified:

- Anonymous and non-member recovery requests are rejected without changing stored state.
- Premature recovery, including a forged client timestamp/actor, cannot force a recovery. Active Reset is a no-op; oversized messages are rejected.
- Two members concurrently recovering the same aged run produce one state transition and one recovery error, preserving the discussion, queued authors, partial output, files, commands, diff and private native context.
- Public session responses do not expose native resume data.
- Old worker checkpoint/final callbacks cannot overwrite the recovered state or a new run.
- Repeated recovery is idempotent; two concurrent Apply actions grant only one next execution.
- Recovery itself makes zero execution attempts. Only this test's disposable database is removed afterward.

Command used (exit 0):

```sh
HIVE_RECOVERY_TEST_DATABASE_URL=postgresql://spenc@127.0.0.1:5432/postgres node --experimental-test-module-mocks scripts/check-stalled-run.mjs
```

The fixture ages `workspace.startedAt` past the six-minute threshold. This does not prove actual Vercel worker termination, Sandbox process cancellation or successful resumed native execution.

## Live Reset and memory source citation

Created a separate [verification task](https://hive-roan-mu.vercel.app/sessions/verify-memory-source-task-after--imrmrq), signed in as Spinsirr, and attached the authorized `spinsirr/hive` repository after the normal GitHub reconnect flow. The prepared coding demonstration task was not changed.

Before running the agent, Reset opened the confirmation dialog explaining the shared, irreversible reset. Cancel preserved the task. During the real memory turn, Reset was disabled with an explanation that Hive was working.

Exactly one prompt was sent:

> Memory 联调样本的验收标识是什么？请只根据本轮自动提供的仓库记忆，回答标识、作者、来源任务 ID、来源消息 ID 和来源回复 ID。若没有匹配记忆就答未召回，不猜测。不要调用任何工具，不查看或修改文件，不保存记忆，不提交或发布。

The prompt supplied none of the answer values. The new task contained no old answer. The final answer correctly distinguished all five fields:

| Field | Observed answer |
| --- | --- |
| Marker | 青桐-0909 |
| Author | Spinsirr |
| Source task | `verify-repository-memory-save-q1wdex` |
| Source message | `initial-1` |
| Source reply | `annotation-1788930878857-3` |

Mem0 recorded one new [successful SEARCH](https://app.mem0.ai/dashboard/requests?requestId=cebcbdd3-f87e-46a0-acc9-e6cedefdf9e3) at **2026-09-10 05:07:39 UTC**, taking **118.10 ms**. It returned the single existing test memory with relevance **0.31**, using the repository-scoped `user_id` and `app_id="hive"` filters. The request list grew from five to six records; there was no new ADD. The memory was the earlier explicitly labeled test contribution, not a new team convention.

A fresh page restored the identical correct answer and reached Live / 1 online. Runs showed **No commands in this turn** and Diff showed **No git diff yet**. No additional model retry, steer, memory save, reset, restore, approval or publication was requested by this verification. No rate-limit failure was visible in this round; this does not establish permanent resolution of Gateway limits.

This closes the specific source-task/message mix-up observed in the earlier 01:12–01:14 UTC round. It is one positive end-to-end provenance check, not a guarantee that every future model answer will cite correctly.

## Open regression: timestamp hydration

The same newly created task greeting initially showed **10:01 PM** Pacific after client-side creation but showed **5:01 AM** after a fresh page load. The incorrect UTC display persisted after the page reached Live. These were new timestamped messages, not legacy records without an epoch.

New standalone reproduction: `scripts/check-message-time-hydration.mjs`.

It renders the actual `MessageTime` component server-side in UTC, then hydrates that HTML with actual React in JSDOM using America/Los_Angeles. A client-only render produces the expected local time, but hydration retains the server text. Repeated executions fail identically:

```text
timestamp: 1789016460000
hydrated:  "5:01 AM"
expected:  "10:01 PM"
```

Reproduction command (observed exit 1 before the follow-up fix):

```sh
node scripts/check-message-time-hydration.mjs
```

At the end of the original test round, this failing reproduction was standalone and not included in `pnpm test`. Existing formatter tests did not exercise the server-render/hydration boundary. No runtime fix had been made at that point.

## Follow-up: local timestamp fix

The owner requested the fix after reviewing these results. The existing reproduction was rerun red; an actual client-only React mount produced the correct local label while hydration of the same epoch retained the server text. This ruled out a missing timestamp or ineffective browser time zone in that reproduction.

`MessageTime` now uses the serialized `message.time` as the identical server/hydration snapshot, then reads the viewer-local label through `useSyncExternalStore`. The old `suppressHydrationWarning` was removed: hiding a mismatch had not updated the retained server DOM text. This follows React's [server snapshot contract](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering). No polling, heartbeat, network request, database migration or dependency was added.

The real-component regression is now included in `pnpm test`. It passes four scenarios: UTC to Pacific daylight time, UTC to Shanghai, Pacific to UTC, and UTC to Pacific standard time. Each also checks client-created messages, legacy labels without timestamps, prop updates, the original `<time>` node and the unchanged machine-readable epoch; hydration must report no recoverable mismatch.

After the fix, `pnpm test` passed all 161 unit tests, 8 recall checks, the four new hydration scenarios and the remaining controlled regressions. Typecheck, lint and diff whitespace checks passed. Only the timestamp component and the test command were changed in runtime/configuration scope; the earlier test evidence remains intact. Production deployment and a fresh-page production check are still pending; no additional agent or Mem0 request was made.

Build verification: the default `pnpm build` first failed to download Google Fonts in the restricted environment, then hit a Turbopack internal IPC port-binding permission error on the network-enabled retry. A supported one-off `pnpm exec next build --webpack` completed successfully, including TypeScript and static page generation. This did not change the configured bundler or production build command. The Webpack build is verified; a default Turbopack build is not claimed as passing in this environment.
