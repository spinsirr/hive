# Message actions

Message editing follows [Slack's in-place interaction](SLACK_MESSAGE_REFERENCE.md), while Hive preserves explicit agent execution boundaries. Production and Demo use the same message, menu, inline editor and steering queue.

## Behavior

- Members edit only their own ordinary messages. Agent output, code quotes, structured interactions and restore receipts remain evidence.
- Edit in place; Save changes or Ctrl/Command+Enter saves, Escape cancels, and Enter remains a newline. The main composer's draft is independent. Failed saves retain the edit draft.
- Identity, author, timestamp, timeline position and Thread stay stable. **Edited** / **View edit history** exposes previous versions; shared history is a Hive choice, not a claim about Slack.
- A pending plain-message edit updates its queued input atomically without reordering it or interrupting a run. Already-dispatched work and whole-Thread steers retain their captured inputs.
- A historical edit changes discussion only. It never starts or retries a model run; subsequent agent context labels revised discussion.
- Captured revision and pending queue identity prevent stale overwrites or editing an input that has already been dispatched. Same-body retries add no duplicate revision.
- Queue actions sit above the composer: edit, reorder, remove, open Thread and Run next at a safe boundary. Removal keeps the conversation message.
- Thread replies remain discussion-only until an explicit whole-Thread steer. Editing neither creates another Thread nor starts a separate agent.
- Existing membership, archive and recovery guards apply. The public response never exposes private harness checkpoint data.

Messages and revisions use existing Postgres JSON records, row-locked actions and versioned WebSocket snapshots. No dependency or schema migration is needed.

## Verification — September 12, 2026

- Reducer and real-component checks cover authorship, frozen execution inputs, optimistic conflicts, idempotent retries, multiline/IME editing, failed draft retention, history and queue controls.
- Disposable loopback Postgres exercises authenticated routes, two fixture accounts, persisted edits/history, concurrent saves and dispatch races. It verifies private workspace/checkpoint context is unchanged while HTTP responses remain redacted.
- The live-client regression covers rejected edits without disconnecting, synchronized history for another viewer and stale snapshot rejection.
- Browser interaction with the shared Demo verified in-place save, unchanged main draft and timestamp, retained history, Escape cancellation with restored keyboard focus, and non-author menus without Edit.

These are regression and local browser results, not production acceptance. Production two-account and real-agent evidence belongs in the PR verification record after deployment.
