import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFileType } from "./workspace-file-type.ts";

test("workspace icons distinguish source, React, documents and assets by filename", () => {
  for (const [path, expected] of [
    ["src/lib/session.ts", "typescript"], ["next-env.d.ts", "typescript"],
    ["scripts/check.mjs", "javascript"], ["index.cjs", "javascript"],
    ["src/app/page.tsx", "react"], ["components/menu.jsx", "react"],
    ["data/fixture.json", "json"], ["docs/README.md", "markdown"],
    ["docs/guide.mdx", "markdown"], ["styles/menu.module.css", "stylesheet"],
    ["scripts/check.sh", "shell"], ["public/logo.svg", "image"],
    ["public/photo.webp", "image"], ["backup.tar.gz", "archive"],
    ["drizzle/0001.sql", "database"], ["index.html", "code"],
  ]) assert.equal(workspaceFileType(path), expected, path);
});

test("package and configuration names take precedence over their extensions", () => {
  for (const path of ["package.json", "app/pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
    assert.equal(workspaceFileType(path), "package", path);
  }
  for (const path of ["next.config.ts", "eslint.config.mjs", "tsconfig.json", "tsconfig.build.json", ".gitignore", ".env.local", ".prettierrc.json", ".github/workflows/check.yml"]) {
    assert.equal(workspaceFileType(path), "config", path);
  }
});

test("file icons normalize case and unknown files remain neutral regardless of parent names", () => {
  assert.equal(workspaceFileType("src/COMPONENT.TSX"), "react");
  assert.equal(workspaceFileType("README.MD"), "markdown");
  assert.equal(workspaceFileType("images/PHOTO.PNG"), "image");
  for (const path of ["LICENSE", "assets.ts/data.unknown", "folder.json/notes", "file.constructor", "file.__proto__", ""]) {
    assert.equal(workspaceFileType(path), "file", path);
  }
});
