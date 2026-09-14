import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { connectAppServer } from "../../src/server/agents/codex/bridge/app-server-connection.mjs";

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

test("copied native bridge loads collaboration skills from its sandbox directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hive-native-bootstrap-"));
  try {
    await cp(
      new URL("../../src/server/agents/codex/bridge/", import.meta.url),
      directory,
      { recursive: true }
    );
    const { prepareNativeThread } = await import(
      pathToFileURL(join(directory, "app-server-connection.mjs")).href
    );
    let skillsReady = false;
    const thread = await prepareNativeThread(
      {
        send: () => {},
        async request(method, params) {
          if (method === "skills/extraRoots/set") {
            assert.equal(params.extraRoots.length, 1);
            const skill = await readFile(
              join(params.extraRoots[0], "hive-collaboration/SKILL.md"),
              "utf8"
            );
            assert.match(skill, /name: hive-collaboration/);
            skillsReady = true;
          }
          if (method === "thread/start") {
            assert.ok(
              skillsReady,
              "Register skills before starting the thread"
            );
            return { thread: { id: "native-thread" } };
          }
          return {};
        },
      },
      { start: { mcpServers: { hive: {} } }, settings: {} }
    );
    assert.equal(thread, "native-thread");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
