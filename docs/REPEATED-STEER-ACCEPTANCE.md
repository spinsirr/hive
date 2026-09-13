# Repeated Steer after newer main-conversation decisions

## Purpose and interface

Verify that a second whole-Thread Steer adds new feedback to the current main
agent's work, rather than replaying an old decision from the source discussion.
Exercise the actual Thread composer, whole-Thread Steer, main composer, and
workspace Files/Runs. The user confirmed this journey on September 12, 2026.

Only `hive-steer-qa.json` in an isolated task's sandbox may change. No commit,
push, deployment, PR, repository memory write, or unrelated file change.
Do not disclose credentials or invitation links in this record.

## Version and live task

- Production: `fa65b8982a52da9b9f8ed7fab3ec338490ba3beb`.
- Deployment: `dpl_5XgjPeqTJvJYQ2FznYkQs8VN3NKR`, confirmed by Vercel inspect
  and that commit's successful deployment status.
- Task: [QA 0912 — repeated Steer and newer main decisions](https://hive-roan-mu.vercel.app/sessions/task-j944ng).
- Queued case: [QA 0912 — queued repeated Steer](https://hive-roan-mu.vercel.app/sessions/task-ivzhdx).
- Member: Spinsirr. Runtime selection: Codex / GPT-5.6 Luna / Low.
- Local `ui/compact-questions` changes are not deployed. Production still has
  the earlier reply destination; do not count it as validation of the new
  main-conversation routing or the unshipped removal of Thread subagents.

## Execution script

| Case | User action | Test purpose / expected observable result |
| --- | --- | --- |
| S0 | Main: create the test file with `{"color":"neutral","radius":0}`; read it back. | Establish a real native run and inspectable file, not a simulated Demo response. |
| S1 | Open a Thread on the initial main message. Reply `Use blue for the color.` Do not Steer yet. | Discussion is saved without executing or changing the file. |
| S2 | Steer that Thread; inspect Files and Runs after completion. | First handoff changes color to `blue`, with radius still `0`. |
| S3 | Main: `Change the color to black. This replaces the earlier color choice.` Wait for completion. | A newer main decision changes the actual file to `black`, radius `0`. |
| S4 | Return to the same Thread; reply `Set the radius to 12.` Steer again. | Final file is `{"color":"black","radius":12}`. The old blue reply stays visible as history but is not replayed. |
| S5 | With no new human reply, inspect/retry the same Steer control. | No duplicate execution; the discussion remains readable. |
| Q1 | In another isolated fixture, establish the same first blue handoff. Start the main black change with a 20-second local-timer wait, then submit the radius reply and Steer while that run is still active. | The second handoff queues without interrupting the current run. Apply it through the normal queue action after the current run completes. |
| Q2 | Inspect Files and Runs after the queued handoff completes. | The queued turn uses the current native context and file: black, radius 12. Main updates are not replaced by the old Thread snapshot. |

The second Thread reply intentionally does not repeat “keep black”: the test
must establish whether the agent reconciles old context with the newer decision,
not whether it can follow an answer embedded in the test prompt.

## Results

All cases start `NOT_RUN`. Record real file contents and execution evidence;
agent prose, a successful submission, or passing local tests are not enough.
Stop a provider-auth/quota failure after one attempt, record it as `BLOCKED`,
and do not silently change models, billing, or credentials.

- S0: PASS. Submitted through the production UI at 19:07 Pacific, September
  12, 2026. Diff showed exactly `{"color":"neutral","radius":0}`. Runs showed
  the existence check and file read both exiting 0. Deployment logs confirmed
  ChatGPT subscription routing to `gpt-5.6-luna`; run
  `agent-139e6d44-ca48-43eb-9cde-51bdbc1f7d7b` recorded 3 native tool calls
  (`bash`, `fileChange`).
- S1: PASS. One human reply was saved; main stayed idle and Steer became
  available. No automatic agent response appeared.
- S2: PASS. The first Steer produced a real diff containing
  `{"color":"blue","radius":0}`. Production delivered the response inside
  the source Thread, consistent with its older deployed routing.
- S3: PASS. Main black-color replacement submitted at 19:11 Pacific. Completed
  Diff showed `{"color":"black","radius":0}`.
- S4: PASS. Submitted only `Set the radius to 12.` in the original Thread at
  19:12 Pacific, then clicked Steer again. The agent reported black / 12 and
  the completed Diff independently showed `{"color":"black","radius":12}`.
  Both original blue messages remained visible in the source Thread.
- S5: PASS. After completion the same Thread contained four replies. Its
  whole-Thread Steer button was disabled without another human contribution.
- Q1: PASS. Separate production task reached neutral / 0, then blue / 0
  through its first Thread Steer, each confirmed in Diff. At 19:17 Pacific,
  submitted the new main black decision with a 20-second local-timer wait after
  writing the file. While this run was active, added `Set the radius to 12.` to
  the original Thread and clicked Queue thread. UI showed one queued item,
  disabled After current run, and Thread queued; main remained working. On
  completion, Diff was black / 0 (no early radius change), Runs showed
  `sleep 20 && cat hive-steer-qa.json` exiting 0, and Run next became enabled.
- Q2: PASS. Clicked the normal Run next action after confirming black / 0.
  The queue changed to Applying Spinsirr's steer. After completion, Diff showed
  exactly `{"color":"black","radius":12}`; Runs showed two file reads exiting
  0. No queued item remained. The old blue choice did not replace the newer
  main decision.
- Local latest-source regression: PASS. The real disposable Postgres suite
  exercises immediate and queued second Steers after a newer main decision.
  Both retain the main native session's newer checkpoint and black file state,
  include the newer main decision alongside the complete Thread and previous
  handoff boundary, and reject a duplicate execution grant. Native run results
  are fixtures in this suite: this is wiring evidence, not model-behavior proof.

Both completed test tasks were archived. This is reversible; messages, files,
and run evidence were retained and no pre-existing user task was altered.

### Native execution evidence (production, immediate case)

All four turns returned HTTP 200 and each recorded three native tool calls
with `bash` and `fileChange`. These are real deployment logs, not fixture data.

| Turn | Run ID | Observed completed Diff |
| --- | --- | --- |
| Create file | `agent-139e6d44-ca48-43eb-9cde-51bdbc1f7d7b` | neutral / 0 |
| First Thread Steer | `agent-bf4b4aff-91fc-4041-a332-2483ec2e42b1` | blue / 0 |
| New main decision | `agent-10d51a1c-2e17-44f2-9376-1950a830fc5e` | black / 0 |
| Second Thread Steer | `agent-543f62d2-8a71-44e6-9876-1f218a963666` | black / 12 |

### Native execution evidence (production, queued case)

The following turns returned HTTP 200, used ChatGPT subscription authentication
with `gpt-5.6-luna`, and recorded native `bash` and `fileChange` tools.

| Turn | Run ID | Native tool calls | Observed completed Diff |
| --- | --- | --- | --- |
| First Thread Steer | `agent-11c8032e-4be9-4301-aa63-909623d80ac3` | 3 | blue / 0 |
| New main decision, including the wait | `agent-05c9e60f-4714-48a2-819b-a69bdf026262` | 2 | black / 0 |
| Queued second Thread Steer | `agent-50e455f2-7b8d-4ec1-93e6-77ddc7864d9d` | 3 | black / 12 |

## Coverage boundary

These two actual production journeys passed on the deployed version and model
above. They do not establish correctness for all models, arbitrary conflicting
instructions, or simultaneous multi-account submissions. The local regression
adds persistent guards for immediate/queued handoff context and duplicate
admission; its native results are fixtures, not additional live-agent runs.

`pnpm test:peer-store` (disposable local Postgres), `pnpm lint`, and
`git diff --check` passed. No deployment or push was performed during this test.
