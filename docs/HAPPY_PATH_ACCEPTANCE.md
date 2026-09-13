# Happy-path experience acceptance

This is an executable **browser journey**, not evidence of a pass. It supplements
[release acceptance](RELEASE_ACCEPTANCE.md). Functional success is necessary but
insufficient: a journey also fails when it loses the reader, hides required input,
jumps between views, duplicates content, or makes a saved action look unconfirmed.

## Run and evidence

Bind each run to one production commit/deployment and record account, browser,
viewport, input method, model/effort and QA task URL. Use the two authorized QA
accounts and isolated tasks. Preserve unrelated work; do not commit code, push,
merge, change credentials, or write memory through the Agent. Follow the release
script's scoped test-data and privacy rules.

Use plausible user requests and natural-language replies for experience testing.
Keep correlation IDs and assertions in the private evidence record, not in the
Agent's requested visible reply. Exact machine-marker responses belong only in
an explicitly identified protocol test; they are not representative UX evidence.

Every row starts NOT_RUN. Keep production observations, local regression and
local browser rechecks separate. Record purpose, exact input/action, expected
behavior, observed behavior, evidence and PASS/FAIL/BLOCKED/NOT_RUN. A fix is not
production-accepted until the deployed revision repeats that journey. Screenshots
show appearance; they do not establish motion, timing or continuous streaming.

For streaming, record click/Enter, local acknowledgement, server acceptance,
first visible text, at least two growing partial bodies, final text and controls
settled. Sample each viewer's actual visible DOM during the run. If instrumentation
misses first text, report an interval, not an exact first-token latency. Preserve
scroll positions, active element, draft and selected workspace tab at those points.
Record frame/animation evidence separately when available. A final screenshot or
instant fixture cannot count as a streaming test.

Run the core journey three times without repairing state between its steps:

1. Standard desktop, keyboard-heavy, first run of a fresh QA task.
2. Desktop, mouse-heavy, established native session with a teammate participating.
3. Narrow viewport (390 × 844), then a real touch/virtual-keyboard pass when available.

Use real model requests on the production runtime. Do not qualify every model
from one successful run, or call a resized desktop browser a real iPhone test.
Record a cold/warm distinction; do not relabel a slow cold start as a warm result.

## Experience budgets

These are acceptance targets, not measurements or provider promises:

- Local acknowledgement should start within 100 ms; anything above 300 ms fails
  the immediate-feedback check. It must distinguish sending from accepted.
- No silent wait: pending feedback remains visible at the actual reply destination
  until text/tool UI appears. At 10+ seconds the task must still look active and
  retain controls; record provider wait separately from rendering delay.
- After a confirmed action, relevant controls/status should settle within 1 second.
  A confirmed answer/restore that still looks pending is a failure.
- Appearance/disappearance uses brief, interruptible opacity/transform motion
  (normally 120–200 ms), only where it explains a state change. No animation is
  preferable to unnecessary motion. No `transition: all`, fake token typing,
  permanent decorative pulse, or per-token entrance animation.
- No unsolicited focus/tab/pane changes; no reading-position jump after the user
  leaves the bottom. The first reply must not restyle/reflow its parent message.
- No page-level horizontal overflow at tested widths. Code/table overflow stays
  inside its own surface; a long message cannot push the composer off screen.

## Continuous journey

| ID  | Test purpose                                  | Execute and required observation                                                                                                                                                                                                                                   |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H01 | Start without ceremony                        | Home → New task. Empty conversation, usable composer; no greeting/title dialog/Agent work. Demo remains findable but does not masquerade as live.                                                                                                                  |
| H02 | Preserve typing intent                        | Type, paste multiline text, select/edit, Shift+Enter, then submit. Caret/selection behave normally; Enter sends once; original text is visible while sending. Real OS IME Enter requires a separate actual-input pass.                                             |
| H03 | Make acceptance unambiguous                   | Send `hi` once. Capture local pending and accepted states, one short reply, cleared accepted draft and sensible title. No lecture, Thread, repository tools or redundant notification bubble.                                                                      |
| H04 | Make model choice predictable                 | Open runtime/model/effort controls by pointer and keyboard, Escape and reopen. No overflow/jump; selection and focus remain clear; disabled options explain actual restrictions.                                                                                   |
| H05 | Show actual streaming                         | Ask for six short sections, a small table and a code example, about 700 words; no tools/files. Observe at least two partial bodies and one final body. No full-response reveal disguised as streaming or duplicated final text.                                    |
| H06 | Maintain follow mode                          | Start at the bottom through first text, paragraphs, code/table and completion. Last text stays reachable; composer geometry is stable; stream cursor and working state finish together.                                                                            |
| H07 | Protect reading                               | During H05, scroll up a screen and read an earlier paragraph. Record its viewport position during further deltas and completion. It does not get dragged down; a named Back to latest action appears.                                                              |
| H08 | Make return intentional                       | Activate Back to latest with keyboard, then repeat with pointer; interrupt a smooth scroll by scrolling up. Focus stays in a sensible reading location when the button disappears; it never opens the mobile keyboard.                                             |
| H09 | Protect parallel drafting                     | Type an unsent follow-up while H05 streams. Text, selection and focus persist through deltas and completion. No accidental submit or model-menu relock that steals focus.                                                                                          |
| H10 | Keep workspace navigation owned by the reader | On Files/Diff, send a normal request; while running switch to another evidence tab. Start/end/queued completion must preserve the user's last choice; only explicit navigation can change it.                                                                      |
| H11 | Reconcile live viewers                        | A streams; B joins/reloads during output. Both see one coherent response, author and eventual result. Loading/sync feedback settles; stale partial text does not replace final text.                                                                               |
| H12 | Keep message identity stable                  | Compare the same human message, Agent answer, question, review and code quote with 0 → 1 → several replies. Parent DOM/body width, padding, bubble, author/time position remain the same; only a lightweight Thread footer appears.                                |
| H13 | Make Thread entry understandable              | Open a Thread, including a long parent and one containing tools. Exactly one entry, accurate count/excerpt, consistent selection; full discussion appears only in its destination.                                                                                 |
| H14 | Preserve navigation and drafts                | Leave different main/Thread drafts, open/close/reopen Thread by click and Escape. Each draft stays separate; closing returns focus to the updated entry; reading/scroll context remains understandable.                                                            |
| H15 | Separate discussion from execution            | Add an ordinary reply. Author/body appear once and no run starts. Steer the whole Thread once. Pending feedback appears inside that Thread before first text, then incremental response and final result stay there.                                               |
| H16 | Scope activity                                | During H15, view an unrelated Thread and use the main composer. Unrelated discussion must not say Hive is replying there; incoming results do not switch or focus it. Returned summary/count must make the originating result discoverable.                        |
| H17 | Ask without forced navigation                 | Agent issues one structured question to B. No automatic Thread; B sees options and A sees the correct addressee. Prompt, options and answer remain one coherent item.                                                                                              |
| H18 | Request attention without taking control      | B is in another Thread/Files, scrolled up or drafting when H17 arrives. A quiet, discoverable indication points B to the question; it does not open a modal, move focus, or auto-switch views. A does not receive a false “your answer needed” cue.                |
| H19 | Settle a decision once                        | B selects and answers; visible pending prevents duplicate submit, then attributed answer and one continuation appear. No duplicate question/Thread, stale attention marker or permanent disabled input. Repeat for a question inside an explicitly steered Thread. |
| H20 | Queue without ambiguity                       | During a real long turn, queue two requests, edit one and remove another. Draft and queue order stay clear; no active-turn restart. Explicit Run next executes only the retained text once, without switching the evidence tab.                                    |
| H21 | Review safely                                 | Real isolated code change → review request → Thread → Diff → Files/Runs → Back to review. Preserve review identity and keyboard focus. Viewing never verifies; only Verify & resolve does.                                                                         |
| H22 | Resolve without celebration noise             | Add feedback, steer, inspect actual reply/evidence, verify. One calm verified state, no duplicate chat receipt or task closure; composer remains ready for further discussion.                                                                                     |
| H23 | Recover without trapping                      | Cancel a restore; then confirm a QA checkpoint once. Read while pending, switch evidence tabs, refresh B. Confirmed files/context settle, discussion/drafts survive, composer unlocks, no automatic run. Timeout is a separate observed condition, never invented. |
| H24 | Put work away and return                      | Archive idle task, observe B, reopen then restore it. Clear shared read-only status, readable evidence, no Agent start, normal controls on return.                                                                                                                 |
| H25 | Finish with stable state                      | Reload both viewers and revisit the QA task. No ghost cursor, duplicated response/Thread, stale activity, missing final text or wrong selected state presented as live work.                                                                                       |

## Cross-cutting passes (not inferred from the journey)

| ID  | Test purpose                | Required exercise                                                                                                                                                                                                                                 |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X01 | Interruptible motion        | Open/close menus, Thread and dialogs rapidly; type during animations. No delayed invisible overlay, swallowed input, animated layout dimensions or exit that steals focus.                                                                        |
| X02 | Reduced motion              | Enable `prefers-reduced-motion` through supported browser/OS controls; repeat stream-follow, Back to latest, menus, Thread and working state. No spring scrolling or decorative movement; state is still understandable. Reset the test override. |
| X03 | Keyboard and focus          | Complete send, Thread, answer, review and close with keyboard. Visible focus, logical tab order, Escape boundaries and final-focus return; no focus on detached nodes.                                                                            |
| X04 | Touch and keyboard geometry | Real mobile browser: focus/blur main and Thread inputs, suggestions and multiline drafts. Virtual keyboard/safe area must not cover send/answer or jump the page. Desktop emulation is partial evidence only.                                     |
| X05 | Responsive real content     | 390, 768, 1280 and 1600+ widths: long names, paragraphs, Markdown table/code, question options, Thread and split resizing. Inspect overflow and parent geometry before/after replies.                                                             |
| X06 | Accessible live feedback    | Inspect log/status names, then actual screen-reader behavior. No token-by-token interruption storm; accepted answer, error and needed input discoverable. DOM semantics alone are not a screen-reader pass.                                       |
| X07 | Draft failure/reconnect     | Real browser disconnect during sending, restore connectivity. Explain unconfirmed delivery, preserve draft, retry with the same identity and reconcile once. Do not destroy production services to reproduce it.                                  |
| X08 | Visual/frame continuity     | Capture a real stream and interaction trace/recording when tooling permits. Look for layout shift, flicker, stalled frames and content reordering. Record tooling limits; do not claim FPS/CLS metrics from snapshots.                            |

## Verdict

“Happy path accepted” requires the relevant H rows to pass continuously on the
released commit, plus keyboard, reduced-motion and responsive checks. Real mobile
keyboard/screen reader/frame profiling gaps remain explicit; never call them
passed from component tests. Any duplication, invisible required input, stolen
focus/navigation, lost draft or stuck completion is a release-blocking UX defect.
Keep a short defect list with reproduction, corrected revision and recheck;
separate genuine remaining work from optional new features.
