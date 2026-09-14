import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import {
  parseManagedCodexAuth,
  type ManagedCodexAuth,
} from "./codex-subscription-credentials.ts";

/** Native Codex owns OAuth refresh. Long-lived credentials never enter a task VM. */
export async function refreshCodexSubscription(auth: ManagedCodexAuth) {
  const sandbox = await Sandbox.create({
    runtime: "node24",
    persistent: false,
    timeout: 90_000,
    resources: { vcpus: 1 },
    tags: { app: "hive", purpose: "subscription-auth" },
  });
  try {
    // Install before introducing credentials; do not use a repository snapshot.
    const install = await sandbox.runCommand(
      "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "@openai/codex@0.149.1",
      ],
      { timeoutMs: 45_000 }
    );
    if (install.exitCode !== 0)
      throw new Error("Codex authentication runtime unavailable.");
    await sandbox.mkDir("/vercel/sandbox/codex-auth");
    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/codex-auth/auth.json",
        content: Buffer.from(JSON.stringify(auth)),
      },
      {
        path: "/vercel/sandbox/refresh.mjs",
        content: await readFile(
          path.join(
            process.cwd(),
            "src/server/agents/codex/codex-auth-refresh.mjs"
          )
        ),
      },
    ]);
    const permissions = await sandbox.runCommand("chmod", [
      "600",
      "/vercel/sandbox/codex-auth/auth.json",
    ]);
    if (permissions.exitCode !== 0)
      throw new Error("Codex credential protection failed.");
    const result = await sandbox.runCommand(
      "node",
      ["/vercel/sandbox/refresh.mjs"],
      { timeoutMs: 30_000 }
    );
    if (result.exitCode !== 0)
      throw new Error("The Codex subscription needs to be reconnected.");
    const file = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/codex-auth/auth.json",
    });
    if (!file || file.length > 32_768)
      throw new Error("Codex did not retain its refreshed login.");
    return parseManagedCodexAuth(JSON.parse(file.toString("utf8")));
  } finally {
    // persistent:false also prevents timeout/error paths from snapshotting auth.
    await sandbox.stop().catch(() => undefined);
  }
}
