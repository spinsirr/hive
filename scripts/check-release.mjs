#!/usr/bin/env node
// Local regression coordinator, not a production browser/model test runner.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stages = [
  { id: "format", args: ["format:check"], boundary: "Repository formatting" },
  { id: "lint", args: ["lint"], boundary: "Static analysis" },
  {
    id: "design-system",
    args: ["test:design-system"],
    boundary: "Shared production/Demo UI ownership",
  },
  {
    id: "types",
    args: ["typecheck"],
    boundary: "Generated routes and TypeScript",
  },
  {
    id: "regression",
    args: ["test"],
    boundary: "Unit/component/route regressions; external services controlled",
  },
  {
    id: "integration",
    args: ["test:integration"],
    boundary:
      "Disposable Postgres, authenticated routes and real local WebSockets; no live models",
  },
  {
    id: "peer-store",
    args: ["test:peer-store"],
    boundary:
      "Disposable Postgres and real MCP client; model completions controlled",
  },
  {
    id: "build",
    args: ["build", "--webpack"],
    boundary: "Production build, not a deployment",
  },
];
const usage =
  "Usage: HIVE_QA_DATABASE_URL=postgres://localhost/postgres pnpm test:release\n       pnpm test:release --plan";
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--plan")) {
  console.error(usage);
  process.exit(2);
}
if (args[0] === "--plan") {
  console.log(
    stages
      .map(
        (stage, index) =>
          `${index + 1}. pnpm ${stage.args.join(" ")}\n   ${stage.boundary}`
      )
      .join("\n")
  );
  console.log(
    "Production acceptance: NOT_RUN. Follow docs/RELEASE_ACCEPTANCE.md separately.\n" +
      usage
  );
  process.exit(0);
}

// Never inherit production credentials. Next also auto-loads .env files, so use
// a dedicated checkout instead of temporarily moving the developer's secrets.
const envFiles = readdirSync(root).filter(
  (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example"
);
if (envFiles.length)
  throw new Error(
    "Use an isolated worktree without .env files. Do not copy production credentials into it."
  );
let database;
try {
  database = new URL(process.env.HIVE_QA_DATABASE_URL ?? "");
} catch {
  throw new Error(
    "Set HIVE_QA_DATABASE_URL to a disposable loopback Postgres server. No tests started."
  );
}
if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
  database.search ||
  database.hash
) {
  throw new Error(
    "Only loopback Postgres without query overrides is accepted. Never use Neon or a production tunnel."
  );
}
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Node.js 24 or newer is required; CI uses Node.js 24.");
if (!existsSync(join(root, "node_modules/.modules.yaml")))
  throw new Error("Run pnpm install --frozen-lockfile in this worktree first.");
if (process.platform === "win32")
  throw new Error(
    "Use a POSIX shell (macOS/Linux/WSL) for the repository's existing test commands."
  );

// pg uses USER when a local connection URL omits its role. Preserve that OS
// identity, but never inherit PG* settings that can redirect the connection.
const env = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "PNPM_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);
env.PATH = `${dirname(process.execPath)}:${env.PATH ?? ""}`;
env.NEXT_TELEMETRY_DISABLED = "1";
env.NO_COLOR = "1";
for (const key of [
  "HIVE_AUTH_TEST_DATABASE_URL",
  "HIVE_ONBOARDING_TEST_DATABASE_URL",
  "HIVE_EGRESS_TEST_DATABASE_URL",
  "HIVE_RECOVERY_TEST_DATABASE_URL",
  "HIVE_PEER_TEST_DATABASE_URL",
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
])
  env[key] = database.toString();
const inspect = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Preflight failed: ${command} ${commandArgs.join(" ")}`);
  return result.stdout.trim();
};
const pnpmVersion = inspect("pnpm", ["--version"]);
const expectedPnpm = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
)
  .packageManager.split("@")
  .at(-1);
if (pnpmVersion !== expectedPnpm)
  throw new Error(
    `Use the packageManager version pinned in package.json (${expectedPnpm}).`
  );
const childNode = inspect("pnpm", ["exec", "node", "--version"]);
if (Number(childNode.replace(/^v/, "").split(".")[0]) < 24)
  throw new Error(
    "pnpm resolves an older Node.js; fix its runtime before testing."
  );
const revision = inspect("git", ["rev-parse", "HEAD"]);
const dirty = inspect("git", ["status", "--short"]);
const sourceHash = async () => {
  const hash = createHash("sha256");
  // Repository-wide formatting can exceed spawnSync's output buffer. Hash the
  // diff as it arrives, without placing a size limit on reviewable changes.
  await new Promise((resolve, reject) => {
    const diff = spawn("git", ["diff", "--binary", "HEAD"], {
      cwd: root,
      env,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    diff.stdout.on("data", (chunk) => hash.update(chunk));
    diff.stderr.resume();
    diff.once("error", reject);
    diff.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not hash the working diff (exit ${code}).`));
    });
  });
  for (const path of inspect("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .sort()) {
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(join(root, path)));
  }
  return hash.digest("hex");
};
const reportDir = mkdtempSync(join(tmpdir(), "hive-release-qa-"));
const report = {
  revision,
  dirty,
  sourceHash: await sourceHash(),
  node: process.version,
  childNode,
  pnpm: pnpmVersion,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  localStatus: "RUNNING",
  productionStatus: "NOT_RUN",
  ciRuntimeMatch:
    process.versions.node.startsWith("24.") && childNode.startsWith("v24."),
  stages: stages.map((stage) => ({
    ...stage,
    status: "NOT_RUN",
    exitCode: null,
    seconds: 0,
    log: `${stage.id}.log`,
  })),
};
const persist = () =>
  writeFileSync(
    join(reportDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 }
  );
persist();
console.log(`Revision: ${revision}\nReports: ${reportDir}`);
if (dirty)
  console.log(
    "Working tree has changes; the report records them. This is not clean-commit CI evidence."
  );
if (!report.ciRuntimeMatch)
  console.log(
    `Runtime differs from CI Node 24 (runner ${process.version}, child ${childNode}); recorded explicitly.`
  );

let interrupted = false;
let stopCurrent;
const interrupt = () => {
  interrupted = true;
  stopCurrent?.();
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
for (const stage of report.stages) {
  if (interrupted) break;
  stage.status = "RUNNING";
  persist();
  console.log(`RUN  ${stage.id}: pnpm ${stage.args.join(" ")}`);
  const started = Date.now();
  const fd = openSync(join(reportDir, stage.log), "wx", 0o600);
  let timedOut = false;
  let killTimer;
  await new Promise((resolve) => {
    const child = spawn("pnpm", stage.args, {
      cwd: root,
      env,
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    const stop = () => {
      if (!child.pid) return;
      // This process group was created for this exact test stage; never target
      // the user's shell, development server or unrelated workers.
      const signal = (name) => {
        try {
          process.kill(-child.pid, name);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      signal("SIGTERM");
      killTimer ??= setTimeout(() => signal("SIGKILL"), 5_000);
    };
    stopCurrent = stop;
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, 15 * 60_000);
    child.once("error", () => {
      stage.status = "FAIL";
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      stopCurrent = undefined;
      stage.exitCode = code;
      stage.signal = signal;
      stage.status = interrupted
        ? "INTERRUPTED"
        : timedOut
          ? "TIMEOUT"
          : code === 0
            ? "PASS"
            : "FAIL";
      resolve();
    });
  });
  closeSync(fd);
  stage.seconds = Math.round((Date.now() - started) / 1000);
  persist();
  console.log(`${stage.status} ${stage.id} (${stage.seconds}s)`);
}
report.finishedAt = new Date().toISOString();
report.localStatus = interrupted
  ? "INTERRUPTED"
  : report.stages.every((stage) => stage.status === "PASS")
    ? "PASS"
    : "FAIL";
report.revisionAtEnd = inspect("git", ["rev-parse", "HEAD"]);
report.dirtyAtEnd = inspect("git", ["status", "--short"]);
report.sourceHashAtEnd = await sourceHash();
if (
  report.revisionAtEnd !== revision ||
  report.dirtyAtEnd !== dirty ||
  report.sourceHashAtEnd !== report.sourceHash
)
  report.localStatus = "CHANGED_DURING_RUN";
persist();
const lines = [
  "# Hive local regression report",
  "",
  `Revision: ${revision}`,
  `Runtime: ${process.version}; pnpm child ${childNode}; pnpm ${pnpmVersion}`,
  `Local: ${report.localStatus}`,
  "Production: NOT_RUN — use docs/RELEASE_ACCEPTANCE.md",
  "",
  ...report.stages.map(
    (stage) =>
      `- ${stage.status}: ${stage.id} (${stage.seconds}s), ${stage.log}`
  ),
  "",
  "Local fixtures are not production or live-model acceptance.",
];
writeFileSync(join(reportDir, "report.md"), lines.join("\n") + "\n", {
  mode: 0o600,
});
console.log(
  `Local: ${report.localStatus}. Production: NOT_RUN.\n${join(reportDir, "report.md")}`
);
process.exitCode = report.localStatus === "PASS" ? 0 : 1;
