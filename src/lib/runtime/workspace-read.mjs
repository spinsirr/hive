import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
const MAX_BYTES = 512 * 1024;
const PAGE_SIZE = 500;
function fail(status, error) {
  throw Object.assign(new Error(error), { status });
}
function restricted(name) {
  return (
    name === ".git" ||
    name === ".harness" ||
    name === ".harness-bootstrap" ||
    (/^\.env(?:\.|$)/i.test(name) &&
      !/\.(example|sample|template)$/i.test(name)) ||
    /^(?:\.npmrc|\.netrc|\.git-credentials|id_rsa|id_ed25519)$/i.test(name) ||
    /\.(pem|key)$/i.test(name)
  );
}
function validPath(value) {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    (value === "" ||
      // Reject ASCII control characters in workspace paths.
      // eslint-disable-next-line no-control-regex
      (!/[\\\x00-\x1f\x7f]/.test(value) &&
        value.split("/").every((p) => p && p !== "." && p !== "..")))
  );
}
(async () => {
  const root = path.resolve(process.argv[1]);
  const request = JSON.parse(process.argv[2]);
  if (
    !validPath(request.path) ||
    !["file", "directory"].includes(request.kind) ||
    !Number.isInteger(request.offset) ||
    request.offset < 0 ||
    request.offset > 1000000 ||
    (request.kind === "file" && !request.path)
  )
    fail(400, "Invalid workspace path.");
  const parts = request.path ? request.path.split("/") : [];
  if (parts.some(restricted))
    fail(403, "Git internals and credential files are not previewed.");
  if ((await fs.lstat(root)).isSymbolicLink())
    fail(403, "Workspace root must not be a symbolic link.");
  const canonicalRoot = await fs.realpath(root);
  let absolute = canonicalRoot;
  for (const part of parts) {
    absolute = path.join(absolute, part);
    if ((await fs.lstat(absolute)).isSymbolicLink())
      fail(403, "Symbolic links are not opened.");
  }
  const resolved = await fs.realpath(absolute);
  const withinRoot = (value) =>
    value === canonicalRoot || value.startsWith(canonicalRoot + path.sep);
  if (!withinRoot(resolved)) fail(403, "Path is outside this workspace.");
  const flags =
    constants.O_RDONLY |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK |
    (request.kind === "directory" ? constants.O_DIRECTORY : 0);
  const handle = await fs.open(resolved, flags);
  try {
    // Linux production uses the opened descriptor, not a path an agent could
    // swap during a concurrent edit. The portable branch supports local tests.
    const descriptorPath =
      process.platform === "linux" ? "/proc/self/fd/" + handle.fd : resolved;
    const openedPath = await fs.realpath(descriptorPath);
    if (!withinRoot(openedPath) || openedPath !== resolved)
      fail(403, "Workspace path changed. Refresh and try again.");
    const stat = await handle.stat();
    if (request.kind === "directory") {
      if (!stat.isDirectory()) fail(400, "This path is not a folder.");
      const entries = (
        await fs.readdir(descriptorPath, { withFileTypes: true })
      )
        .map((entry) => ({
          name: entry.name,
          path: parts.concat(entry.name).join("/"),
          kind: restricted(entry.name)
            ? "restricted"
            : entry.isSymbolicLink()
              ? "symlink"
              : entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "other",
        }))
        .sort(
          (a, b) =>
            Number(b.kind === "directory") - Number(a.kind === "directory") ||
            a.name.localeCompare(b.name, "en", { numeric: true }) ||
            (a.name < b.name ? -1 : 1)
        );
      const end = request.offset + PAGE_SIZE;
      return {
        kind: "directory",
        path: request.path,
        entries: entries.slice(request.offset, end),
        nextOffset: end < entries.length ? end : null,
      };
    }
    if (!stat.isFile()) fail(415, "Only regular text files can be previewed.");
    if (stat.size > MAX_BYTES)
      fail(413, "This file exceeds the 512 KB preview limit.");
    // Read at most MAX_BYTES + 1 even if another process grows the file.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(
        buffer,
        bytes,
        buffer.length - bytes,
        null
      );
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > MAX_BYTES)
      fail(413, "This file exceeds the 512 KB preview limit.");
    const data = buffer.subarray(0, bytes);
    if (data.includes(0))
      fail(415, "Binary files cannot be displayed in the code editor.");
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      fail(415, "This file is not UTF-8 text.");
    }
    return { kind: "file", path: request.path, content, bytes };
  } finally {
    await handle.close();
  }
})()
  .then((data) => process.stdout.write(JSON.stringify({ status: 200, data })))
  .catch((error) => {
    const status =
      error.status ||
      (["ENOENT", "ENOTDIR"].includes(error.code)
        ? 404
        : ["EACCES", "EPERM", "ELOOP"].includes(error.code)
          ? 403
          : 500);
    const message = error.status
      ? error.message
      : status === 404
        ? "This path no longer exists. Refresh the workspace."
        : status === 403
          ? "This path cannot be opened."
          : "Workspace could not be read. Try again.";
    process.stdout.write(JSON.stringify({ status, error: message }));
  });
