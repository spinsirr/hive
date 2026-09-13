# Multiplayer awareness and queued continuation

This change gives the agent two task-scoped read tools:

- `get_presence`: observe connected people in the current task, with names, a unique-person count and an observation time. Multiple tabs count once. The observer is not counted as a participant. Members who are no longer authorized are filtered out. Presence is best effort: delayed announcements and the existing 90-second connection lease can affect freshness. Unavailable presence is not reported as zero.
- `read_thread`: read an existing message and pages of 20 attributed replies, including discussions outside the recent context window. Queued instructions remain withheld. Reading discussion does not authorize executing it.

Both use the existing authenticated task/run boundary, work before repository attachment, and are available through the shared MCP definitions to native Codex/Claude and Gateway conversation tools. Per-turn guidance explains when to use them without changing native harness instruction fingerprints.

Presence uses a short-lived observer of the existing Postgres notification relay. It does not create durable presence rows, publish fake members or grant access to another task. The observation waits briefly for other instances' connection announcements, then closes its subscription.

## Queue behavior

Already-submitted messages, answers and explicitly steered discussions automatically continue when the previous run finishes successfully and a connected client observes readiness. Ordinary Thread replies still require an explicit steer.

The continuation names the exact queue head. A transaction grants execution once, even when multiple browsers submit it concurrently; a stale request cannot consume the next item. Errors and restored queue history remain paused for explicit Run next. A lost action response can retry on reconnect. This is client-observed continuation, not durable background scheduling when every client is closed.

## Verification

Local checks cover real React continuation, state transitions, stale-head rejection, reconnect retry, error/restore pauses, revoked access, no-repository tool availability and queued-content withholding. A disposable local Postgres check exercises concurrent execution grants. Independent real Postgres listeners and WebSockets verify that a separate observer sees connected people without inflating counts.

These checks use fixture model results. Production two-account acceptance and real Codex/Claude calls for the new tools remain required after deployment. Refresh both browser clients after releasing the updated continuation action.
