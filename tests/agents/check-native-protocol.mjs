import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { prepareSandboxForHarness } from "@ai-sdk/harness/agent";
import { createCodex } from "@ai-sdk/harness-codex";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createHiveCodex } from "../../src/server/agents/codex/codex-harness.ts";
import { connectAppServer } from "../../src/server/agents/codex/bridge/app-server-connection.mjs";
import { createTaskEnvironment } from "../../src/server/workspace/task-environment.ts";

const execute = promisify(execFile);

for (const [runtime, createHarness] of [
  ["Codex", createCodex],
  ["Claude", createClaudeCode],
]) {
  test(`repository workspaces cannot redirect ${runtime} Harness dependency installation`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "hive-workspace-bootstrap-")
    );
    const rootLock =
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n";
    try {
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ private: true })
      );
      await writeFile(
        join(directory, "pnpm-workspace.yaml"),
        "allowBuilds:\n  esbuild: true\n"
      );
      await writeFile(join(directory, "pnpm-lock.yaml"), rootLock);
      await mkdir(join(directory, "dependency"));
      await writeFile(
        join(directory, "dependency/package.json"),
        JSON.stringify({
          name: "hive-bootstrap-fixture",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
        })
      );
      await writeFile(
        join(directory, "dependency/index.js"),
        "export const ready = true;\n"
      );

      const upstream = createHarness({ auth: {} });
      const recipe = await upstream.getBootstrap();
      const installCommands = recipe.commands.filter(({ command }) =>
        command.startsWith("pnpm install ")
      );
      assert.ok(
        installCommands.length,
        "Exercise the adapter's real installer"
      );
      const fixture = {
        ...upstream,
        async getBootstrap() {
          return {
            ...recipe,
            // A local dependency keeps this installation regression offline.
            // The installer and its parent workspace are real, not process mocks.
            files: [
              {
                path: `${recipe.bootstrapDir}/package.json`,
                content: JSON.stringify({
                  private: true,
                  dependencies: {
                    "hive-bootstrap-fixture": "link:../../dependency",
                  },
                }),
              },
              {
                path: `${recipe.bootstrapDir}/pnpm-lock.yaml`,
                content:
                  "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      hive-bootstrap-fixture:\n        specifier: link:../../dependency\n        version: link:../../dependency\n",
              },
            ],
            commands: [
              ...installCommands,
              // Runtime smoke commands need the real SDK; this fixture checks
              // resolution of the installed dependency without downloading it.
              {
                command:
                  "node --input-type=module -e \"const {ready} = await import('hive-bootstrap-fixture'); if (!ready) process.exit(1)\"",
              },
            ],
          };
        },
      };
      const commands = [];
      const session = {
        defaultWorkingDirectory: directory,
        async readTextFile({ path }) {
          try {
            return await readFile(path, "utf8");
          } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
          }
        },
        async writeTextFile({ path, content }) {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content);
        },
        async run({ command, workingDirectory, env }) {
          commands.push(command);
          try {
            return {
              ...(await execute("sh", ["-c", command], {
                cwd: workingDirectory,
                env: { ...process.env, ...env, CI: "true" },
                timeout: 30_000,
              })),
              exitCode: 0,
            };
          } catch (error) {
            return {
              exitCode: error.code,
              stdout: error.stdout,
              stderr: error.stderr,
            };
          }
        },
      };
      const harness = createTaskEnvironment({
        sessionId: "bootstrap-test",
        workspace: {},
      }).wrap(fixture);
      const prepare = () =>
        prepareSandboxForHarness({ session, harnesses: [harness] });
      const installed = await prepare();
      assert.equal(
        await readFile(join(directory, "pnpm-lock.yaml"), "utf8"),
        rootLock,
        "bootstrapping must not change the repository lockfile"
      );
      commands.length = 0;
      assert.deepEqual(await prepare(), installed);
      assert.deepEqual(
        commands,
        [],
        "a warm turn reuses the validated installation"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

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

test("Harness owns installation and validates an upgraded bridge before caching it", async () => {
  const historyPath = "/sandbox/.codex/sessions/rollout.jsonl";
  const files = new Map([[historyPath, "existing native context"]]);
  const commands = [];
  let failCheck = true;
  const session = {
    defaultWorkingDirectory: "/sandbox",
    async readTextFile({ path }) {
      return files.get(path) ?? null;
    },
    async writeTextFile({ path, content }) {
      files.set(path, content);
    },
    async run({ command, workingDirectory }) {
      commands.push(command);
      if (!command.startsWith("mkdir"))
        assert.equal(workingDirectory, "/sandbox/.harness-bootstrap/codex");
      return {
        exitCode: failCheck && command.includes("./app-server.mjs") ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    },
  };
  const prepare = (harness) =>
    prepareSandboxForHarness({ session, harnesses: [harness] });
  // An existing sandbox has the upstream recipe marker, files and native history.
  const previous = await prepare(createCodex({ auth: {} }));
  const previousFiles = new Set(files.keys());
  const hive = createHiveCodex({ auth: {} });
  await assert.rejects(prepare(hive), /Bootstrap command failed/);
  assert.equal(
    [...files.keys()].filter(
      (path) => !previousFiles.has(path) && path.endsWith(".ok")
    ).length,
    0,
    "a failed bridge check must not cache a broken installation"
  );
  failCheck = false;
  commands.length = 0;
  const current = await prepare(hive);
  assert.notEqual(current.identity, previous.identity);
  assert.match(commands[1], /pnpm install --frozen-lockfile/);
  assert.match(commands[2], /import\('@openai\/codex-sdk'\)/);
  assert.match(commands[2], /import\('\.\/app-server\.mjs'\)/);
  assert.equal(files.get(historyPath), "existing native context");
  commands.length = 0;
  assert.deepEqual(await prepare(hive), current);
  assert.deepEqual(
    commands,
    [],
    "an unchanged resumed sandbox reuses the SDK bootstrap cache"
  );
});

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
