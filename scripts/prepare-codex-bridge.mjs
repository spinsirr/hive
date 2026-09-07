import { copyFile, mkdir } from "node:fs/promises";

// Package the public harness runtime as a sandbox asset, outside Next's module
// bundler. No private adapter source or generated-source rewriting is needed.
const destination = new URL("../node_modules/.cache/hive/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL(import.meta.resolve("@ai-sdk/harness/bridge")), new URL("codex-bridge.mjs", destination));
