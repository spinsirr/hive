import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  workspaceReadRequest,
  workspaceReadResponse,
} from "./workspace-files.ts";
const workspaceReadScript = await readFile(
  new URL("../../server/workspace/workspace-read.mjs", import.meta.url),
  "utf8"
);

let fixture: string;
let root: string;
function read(relative: string, kind = "file", offset = 0, directory = root) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        workspaceReadScript,
        directory,
        JSON.stringify({ kind, path: relative, offset }),
      ],
      { timeout: 5_000, maxBuffer: 2_000_000 }
    ).toString()
  );
}

before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "hive-files-test-"));
  root = path.join(fixture, "repo");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "empty-folder"));
  await mkdir(path.join(root, "many"));
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(fixture, "outside.txt"), "DO NOT EXPOSE OUTSIDE");
  for (const name of [
    "unchanged.ts",
    "untracked.ts",
    ".gitignore",
    ".env.example",
    "空 格'|$(echo injected).ts",
  ]) {
    await writeFile(
      path.join(root, name),
      `// ${name}\nconst message = "你好";\n`
    );
  }
  await writeFile(
    path.join(root, "src", "main.tsx"),
    "export const Main = () => <div>Hello</div>;\n"
  );
  await writeFile(path.join(root, "empty.txt"), "");
  await writeFile(path.join(root, ".env.local"), "TOKEN=DO NOT EXPOSE SECRET");
  await writeFile(
    path.join(root, ".git", "config"),
    "DO NOT EXPOSE GIT CREDENTIALS"
  );
  await writeFile(path.join(root, "private.pem"), "DO NOT EXPOSE KEY");
  await writeFile(path.join(root, "binary.png"), Buffer.from([0, 1, 2, 3]));
  await writeFile(
    path.join(root, "invalid-utf8.txt"),
    Buffer.from([0xff, 0xfe])
  );
  await writeFile(
    path.join(root, "huge.txt"),
    Buffer.alloc(512 * 1024 + 1, 65)
  );
  await symlink(
    path.join(fixture, "outside.txt"),
    path.join(root, "linked.txt")
  );
  await symlink(fixture, path.join(root, "linked-folder"));
  await symlink(root, path.join(fixture, "linked-root"));
  await Promise.all(
    Array.from({ length: 507 }, (_, index) =>
      writeFile(path.join(root, "many", `file-${index}.ts`), "")
    )
  );
});
after(async () => {
  await rm(fixture, { recursive: true, force: true });
});

test("workspace tree includes unchanged, untracked, hidden and nested files, not just diff snapshots", () => {
  const result = read("", "directory");
  assert.equal(result.status, 200);
  assert.equal(workspaceReadResponse.safeParse(result.data).success, true);
  assert.ok(result.data.entries.length > 12);
  const entries = new Map(
    result.data.entries.map((entry: { name: string; kind: string }) => [
      entry.name,
      entry.kind,
    ])
  );
  for (const name of [
    "unchanged.ts",
    "untracked.ts",
    ".gitignore",
    ".env.example",
    "空 格'|$(echo injected).ts",
  ])
    assert.equal(entries.get(name), "file");
  assert.equal(entries.get("src"), "directory");
  assert.equal(entries.get("linked-folder"), "symlink");
  assert.equal(entries.get(".env.local"), "restricted");
  assert.equal(entries.get(".git"), "restricted");
  assert.equal(result.data.entries[0].kind, "directory");
  assert.deepEqual(
    read("src", "directory").data.entries.map(
      (entry: { name: string }) => entry.name
    ),
    ["main.tsx"]
  );
  assert.deepEqual(read("empty-folder", "directory").data.entries, []);
});

test("directory pagination exposes every entry beyond the first 500", () => {
  const first = read("many", "directory").data;
  const second = read("many", "directory", first.nextOffset).data;
  assert.equal(first.entries.length, 500);
  assert.equal(first.nextOffset, 500);
  assert.equal(second.entries.length, 7);
  assert.equal(second.nextOffset, null);
  assert.equal(
    new Set([...first.entries, ...second.entries].map((entry) => entry.path))
      .size,
    507
  );
});

test("file reads preserve UTF-8, empty files and shell-like filenames without executing them", async () => {
  for (const name of [
    "src/main.tsx",
    "空 格'|$(echo injected).ts",
    "empty.txt",
    ".env.example",
  ]) {
    const result = read(name);
    assert.equal(result.status, 200);
    assert.equal(
      result.data.content,
      await readFile(path.join(root, name), "utf8")
    );
    assert.equal(result.data.bytes, Buffer.byteLength(result.data.content));
  }
});

test("request schema and sandbox both reject absolute, traversal, control and malformed paths", () => {
  for (const name of [
    "/etc/passwd",
    "../outside.txt",
    "src/../../outside.txt",
    "src//main.tsx",
    "./unchanged.ts",
    "src/",
    "src\\main.tsx",
    "a\u0000b",
    "a\nb",
  ]) {
    assert.equal(
      workspaceReadRequest.safeParse({ kind: "file", path: name }).success,
      false,
      name
    );
    assert.equal(read(name).status, 400, name);
  }
  assert.equal(read("").status, 400);
  assert.equal(read("", "directory", -1).status, 400);
  assert.equal(read("", "write").status, 400);
});

test("symlinks, credential files and Git internals never leak their contents", () => {
  for (const name of [
    "linked.txt",
    "linked-folder/outside.txt",
    ".env.local",
    "private.pem",
    ".git/config",
  ]) {
    const result = read(name);
    assert.equal(result.status, 403, name);
    assert.doesNotMatch(JSON.stringify(result), /DO NOT EXPOSE/);
  }
  assert.equal(
    read("unchanged.ts", "file", 0, path.join(fixture, "linked-root")).status,
    403
  );
});

test("binary, oversized, non-UTF8 and missing files return honest bounded preview errors", () => {
  assert.equal(read("binary.png").status, 415);
  assert.equal(read("invalid-utf8.txt").status, 415);
  assert.equal(read("huge.txt").status, 413);
  assert.equal(read("src").status, 415);
  assert.equal(read("deleted.ts").status, 404);
});
