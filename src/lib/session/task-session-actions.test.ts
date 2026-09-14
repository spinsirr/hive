import assert from "node:assert/strict";
import test from "node:test";
import { clientTaskSessionActionSchema as schema } from "./task-session-actions.ts";
import type { TaskSessionSnapshot } from "./task-session-contract.ts";

test("the action boundary owns payload limits, submission identity and server-only fields", () => {
  const message = {
    type: "send-message",
    body: "hello",
    clientId: crypto.randomUUID(),
  };
  assert.equal(
    schema.safeParse({ ...message, body: "x".repeat(8001) }).success,
    false
  );
  assert.equal(
    schema.safeParse({ ...message, clientId: undefined }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      ...message,
      type: "annotate-message",
      messageId: "m",
      body: "x".repeat(4001),
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      type: "edit-message",
      messageId: "m",
      body: "ok",
      expectedRevision: 0.5,
    }).success,
    false
  );
  assert.equal(schema.safeParse({ type: "connect-repository" }).success, false);
  assert.deepEqual(
    schema.parse({
      ...message,
      actor: "forged",
      repository: { installationId: 123 },
    }),
    message
  );
  assert.equal(
    schema.safeParse({ type: "set-coding-effort", effort: "invented" }).success,
    false
  );
});

// Compile-time boundary checks: client code cannot read native recovery data.
export function assertPublicContract(snapshot: TaskSessionSnapshot) {
  // @ts-expect-error Native recovery is server-only.
  void snapshot.session.workspace.agentSession?.resumeFrom;
  // @ts-expect-error Saved native checkpoints are server-only.
  void snapshot.session.workspace.checkpoints;
  // @ts-expect-error Cold snapshot pairing is server-only.
  void snapshot.session.workspace.idleCheckpoint;
  // @ts-expect-error Restore VM identity is server-only.
  void snapshot.session.workspace.restore?.sourceSessionId;
}
