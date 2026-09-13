// Opt-in real infrastructure check: compare cold-per-turn startup with the
// Harness bootstrap cache. No prompts, model calls, repository or model auth.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Sandbox } from "@vercel/sandbox";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";

assert.ok(
  process.argv.includes("--live"),
  "Pass --live to create temporary Vercel sandboxes."
);
for (const key of ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"]) {
  assert.ok(process.env[key], `${key} is required.`);
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return next("next/dist/compiled/server-only/empty.js", context);
    if (specifier.startsWith("@/"))
      return next(
        new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        context
      );
    return next(specifier, context);
  },
});
const { createHiveCodex } = await import("../../src/lib/codex-harness.ts");
const { ensureCodexBridgeDependencies } =
  await import("../../src/lib/hive-runner.ts");
const credentials = {
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
};
const options = {
  ...credentials,
  runtime: "node24",
  ports: [4319],
  timeout: 180_000,
  resources: { vcpus: 1 },
};
const templateArgument = process.argv.indexOf("--reuse-template");
const reusedTemplate =
  templateArgument < 0 ? undefined : process.argv[templateArgument + 1];
if (templateArgument >= 0)
  assert.match(reusedTemplate ?? "", /^hive-qa-startup-[a-f0-9-]{36}$/);
const templateName = reusedTemplate ?? `hive-qa-startup-${randomUUID()}`;
let templateAttempted = false;
const results = [];
const trace = process.argv.includes("--trace");
const budgetArgument = process.argv.indexOf("--max-cached-ready-ms");
const cachedBudgetMs =
  budgetArgument < 0 ? undefined : Number(process.argv[budgetArgument + 1]);
if (cachedBudgetMs !== undefined)
  assert.ok(Number.isFinite(cachedBudgetMs) && cachedBudgetMs > 0);

// Instrument only public Sandbox calls. Never print commands, paths, contents,
// environment variables or method arguments, which may contain credentials.
function traceSession(session, spans, elapsed) {
  return new Proxy(session, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "restricted")
        return () => traceSession(value.call(target), spans, elapsed);
      if (typeof value !== "function") return value;
      if (
        ![
          "run",
          "spawn",
          "readTextFile",
          "writeTextFile",
          "getPortEndpoint",
          "setRequestTransformations",
        ].includes(key)
      )
        return value.bind(target);
      return async (...args) => {
        const startedMs = elapsed();
        try {
          return await value.apply(target, args);
        } finally {
          spans.push({
            method: key,
            startedMs,
            durationMs: elapsed() - startedMs,
          });
        }
      };
    },
  });
}

const failures = [];
try {
  for (const mode of reusedTemplate
    ? ["cached-new-process"]
    : trace
      ? ["cached-first", "cached-repeat", "cached-repeat"]
      : ["uncached", "cached-first", "cached-repeat", "cached-repeat"]) {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const timings = { mode };
    const spans = [];
    let rawSandbox, session, sandboxSession, workDir, acquiredNetworkSession;
    try {
      if (mode === "uncached") rawSandbox = await Sandbox.create(options);
      else templateAttempted = true;
      const native = createHiveCodex({
        auth: {},
        reasoningEffort: "low",
        webSearch: false,
      });
      const provider = rawSandbox
        ? createVercelSandbox({ sandbox: rawSandbox })
        : createVercelSandbox({ ...options, name: templateName });
      if (trace) {
        const createSession = provider.createSession.bind(provider);
        provider.createSession = async (args) => {
          const created = await createSession(args);
          acquiredNetworkSession = created;
          timings.vmReadyMs = elapsed();
          return traceSession(created, spans, elapsed);
        };
      }
      const agent = new HarnessAgent({
        id: "hive-startup-diagnostic",
        model: "gpt-5.6-luna",
        permissionMode: "allow-all",
        harness: {
          ...native,
          async doStart(args) {
            timings.bridgeStartMs = elapsed();
            const runtime = await native.doStart(args);
            timings.bridgeReadyMs = elapsed();
            return runtime;
          },
        },
        sandbox: provider,
        sandboxConfig: {
          workDir: "planning",
          async onSession({ session: sandbox, sessionWorkDir, abortSignal }) {
            sandboxSession = sandbox;
            workDir = sessionWorkDir;
            timings.bootstrapReadyMs = elapsed();
            await ensureCodexBridgeDependencies(
              sandbox,
              sessionWorkDir,
              abortSignal
            );
            timings.dependenciesReadyMs = elapsed();
          },
        },
      });
      session = await agent.createSession({
        abortSignal: AbortSignal.timeout(150_000),
      });
      timings.readyMs = elapsed();
      results.push({ ...timings });
      console.log(JSON.stringify(timings));
      if (trace) console.log(JSON.stringify({ mode, spans }));
      // No prompt/model call. A per-session marker must never reach another VM.
      const isolation = await sandboxSession.run({
        command: "test ! -e startup-qa-marker",
        workingDirectory: workDir,
      });
      assert.equal(
        isolation.exitCode,
        0,
        "Per-turn files must not enter the bootstrap template."
      );
      await sandboxSession.writeTextFile({
        path: `${workDir}/startup-qa-marker`,
        content: "diagnostic-only",
      });
      if (process.argv.includes("--warm-resume") && mode === "cached-repeat") {
        const sessionId = session.sessionId;
        const resumeFrom = await session.detach();
        session = undefined;
        const resumeStarted = performance.now();
        // Public Harness lifecycle: park the live bridge, then acquire a new
        // handle via the provider. No model invocation or host-only session map.
        session = await agent.createSession({
          sessionId,
          resumeFrom,
          abortSignal: AbortSignal.timeout(30_000),
        });
        const resumed = {
          mode: "live-bridge-resume",
          readyMs: Math.round(performance.now() - resumeStarted),
        };
        results.push(resumed);
        console.log(JSON.stringify(resumed));
        const marker = await sandboxSession.run({
          command: "test -e startup-qa-marker",
          workingDirectory: workDir,
        });
        assert.equal(
          marker.exitCode,
          0,
          "A live resume must stay in the same task sandbox."
        );
      }
    } finally {
      await session?.destroy();
      // A failed acquisition after detach has no active Harness handle left.
      // Delete only the diagnostic VM acquired by this iteration.
      if (!session) await acquiredNetworkSession?.destroy();
      if (rawSandbox) {
        await rawSandbox.stop();
        await rawSandbox.delete({ deleteOrphanSnapshots: true });
      }
    }
  }
  if (!reusedTemplate && !trace) {
    // A fresh serverless process has no in-memory snapshot cache. Exercise the
    // provider's persisted template lookup as well, without mocking its SDK.
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          "--live",
          "--reuse-template",
          templateName,
        ],
        { stdio: "inherit" }
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Fresh-process startup failed (${code}).`))
      );
    });
  }
  console.log(
    JSON.stringify({
      purpose: "Real startup only, not production TTFT",
      results,
    })
  );
  if (cachedBudgetMs !== undefined) {
    const cached = results.filter(
      (result) =>
        result.mode === "cached-repeat" || result.mode === "cached-new-process"
    );
    assert.ok(cached.length > 0);
    assert.ok(
      cached.every((result) => result.readyMs < cachedBudgetMs),
      `Cached runtime preparation exceeds ${cachedBudgetMs} ms before authentication or model inference.`
    );
  }
} catch (error) {
  failures.push(error);
} finally {
  if (templateAttempted && !reusedTemplate) {
    try {
      const template = await Sandbox.get({
        ...credentials,
        name: templateName,
      });
      await template.delete({ deleteOrphanSnapshots: true });
      console.log(
        "Removed the diagnostic-only bootstrap template and its orphan snapshots."
      );
    } catch (error) {
      if (error?.response?.status !== 404) failures.push(error);
      else console.log("No diagnostic template was created.");
    }
  }
}

if (failures.length)
  throw new AggregateError(
    failures,
    "Startup diagnostic or template cleanup failed."
  );
