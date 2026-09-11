# Message actions

Requested September 10, 2026. The conversation and queue use the same compact menu and edit composer; the UI preview at `/demo/conversation` uses those production components with invented data and no model calls.

## Behavior

- A member can edit only their own ordinary conversation messages. Agent output and quoted code selections remain evidence; discuss them in a Thread instead.
- Editing a pending message updates both its displayed text and its queued input atomically, without moving it or interrupting the active run.
- Editing already-dispatched text changes the discussion, not the saved native agent history. It never starts/retries a run. Previous versions remain visible through **Edited** / **View edit history**.
- A queued whole-thread steer keeps its frozen discussion boundary. Editing its parent does not rewrite that saved steer.
- Editing captures the message revision and pending queue identity. Another edit or a dequeue before saving produces a conflict, not an overwrite. Failed saves leave the draft in the editor.
- **Remove from queue** cancels pending direction, not the conversation. Existing member-controlled reordering and safe-boundary application remain available.
- **Open thread** reuses the existing discussion. This change adds neither a second independent agent chat nor a switch that disables shared execution serialization.

Messages and revisions use the existing Postgres JSON message records, row-locked action path and versioned WebSocket snapshots. No new dependency, migration, polling loop, model request or external memory write is needed to edit a message.

## Verification — September 10 Pacific

- `pnpm test`: 186 unit tests, memory checks and controlled regression suites pass, including the new message UI check.
- `pnpm test:messages`: own-message menu, copy, Thread, CJK/multiline editing, failed-draft retention, history, queued edit/removal and running-agent lock pass.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`, and `pnpm build --webpack`: pass.
- `scripts/check-onboarding.mjs` on disposable loopback Postgres with Node 24: the real authenticated action/GET routes reject identity spoofing and malformed edits; store text/history across reads by both fixture accounts; serialize competing updates into one success and one conflict; reject the old queue editor after application. External model calls are forbidden in this fixture.
- `scripts/check-shared-session.mjs`: the real client hook preserves online status on a rejected edit, publishes saved text/history to another viewer, and rejects a stale snapshot.
- Browser UI preview: edited a historical sample message; queued, edited and removed a follow-up; checked the **Edited** marker and unchanged discussion after removal. At 390 × 844, document/editor width was 390 px and the open menu remained within the viewport. Temporary viewport override was reset.

These are local/fixture and browser-preview results. They are not a claim of production two-account message-edit acceptance; that remains a post-deployment check. Preview edits intentionally reset on reload, unlike authenticated task data.
