import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { connectAppServer } from "../src/lib/codex-bridge/app-server-connection.mjs";

function nativeServer(receive) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(line, _, done) {
      receive(JSON.parse(String(line)), child.stdout);
      done();
    },
    final(done) {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
      done();
    },
  });
  return child;
}

test("RPC and child notifications continue after the main event iterator finishes", async () => {
  const delivered = [];
  const connection = connectAppServer(
    nativeServer((request, output) => {
      output.write(
        JSON.stringify({
          method: "item/started",
          params: { threadId: "child" },
        }) + "\n"
      );
      output.write(
        JSON.stringify({ id: request.id, result: { method: request.method } }) +
          "\n"
      );
    }),
    {
      onNotification: (message) => delivered.push(message),
      onRequest: () => assert.fail("Unexpected interactive request"),
    }
  );
  try {
    assert.deepEqual(await connection.request("turn/start", {}), {
      method: "turn/start",
    });
    const first = await connection.notifications[Symbol.asyncIterator]().next();
    assert.equal(first.value.params.threadId, "child");
    connection.notifications.destroy();
    assert.deepEqual(await connection.request("thread/read", {}), {
      method: "thread/read",
    });
    assert.equal(
      delivered.length,
      2,
      "Each native notification is delivered once, including during drain"
    );
  } finally {
    await connection.shutdown();
  }
});

test("malformed native output rejects in-flight RPC instead of silently continuing", async () => {
  const connection = connectAppServer(
    nativeServer((_, output) => output.write("{broken-json\n")),
    {
      onNotification: () =>
        assert.fail("Malformed input was treated as activity"),
      onRequest: () => assert.fail("Malformed input was treated as a request"),
    }
  );
  try {
    await assert.rejects(connection.request("thread/read", {}), SyntaxError);
    assert.ok(connection.error instanceof SyntaxError);
  } finally {
    await connection.shutdown();
  }
});
