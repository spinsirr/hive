import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectArtifacts } from "./workspace-artifacts.ts";

test("artifact budgets preserve raw Git data, deleted files and unusual names", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hive-artifacts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Commit hooks export repository locations; the fixture must own its Git state.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
    ),
    NODE_ENV: process.env.NODE_ENV,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, stdio: "pipe", env });
  git("init");
  assert.equal(
    await realpath(git("rev-parse", "--absolute-git-dir").toString().trim()),
    await realpath(path.join(directory, ".git"))
  );
  await writeFile(path.join(directory, "deleted.txt"), "original\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture"
  );
  await rm(path.join(directory, "deleted.txt"));
  const filename = " 空 格中文\nfile.txt";
  await writeFile(path.join(directory, filename), "x".repeat(30_000) + "\n");
  const reads: string[] = [];
  const sandbox = {
    async run({
      command,
      workingDirectory,
    }: {
      command: string;
      workingDirectory?: string;
    }) {
      const result = spawnSync("bash", ["-c", command], {
        cwd: workingDirectory,
        encoding: "utf8",
        env,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.status ?? 1,
      };
    },
    async readTextFile({ path: filename }: { path: string }) {
      reads.push(filename);
      return readFile(filename, "utf8");
    },
  };
  const result = await collectArtifacts(sandbox, [], directory);
  assert.deepEqual(result.changedFiles, ["deleted.txt", filename]);
  assert.ok(result.diff.length > 30_000);
  assert.doesNotMatch(result.diff, /output truncated/);
  assert.match(result.files[0].content, /output truncated/);
  assert.deepEqual(reads, [path.join(directory, filename)]);
  await writeFile(path.join(directory, filename), "y".repeat(70_000) + "\n");
  const large = await collectArtifacts(sandbox, [], directory);
  assert.equal(large.diff.indexOf("\n\n[output truncated by Hive]"), 60_000);
  assert.deepEqual(large.changedFiles, result.changedFiles);
  await Promise.all(
    Array.from({ length: 14 }, (_, index) =>
      writeFile(path.join(directory, `extra-${index}.txt`), "small preview")
    )
  );
  const many = await collectArtifacts(sandbox, [], directory);
  assert.equal(
    many.changedFiles.length,
    16,
    "The change list remains complete when file previews are capped"
  );
  assert.equal(many.files.length, 12);
});
