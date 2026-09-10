// Operator-only, one-time binding. Never accepts credentials from a task/browser.
// Supply DATABASE_URL, HIVE_CODEX_AUTH_SECRET and explicit --session, --owner,
// --repository-id, --auth-file. This command never overwrites a vault entry.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { codexAccountHash, codexAuthNeedsRefresh, parseManagedCodexAuth, sealCodexAuth } from "../src/lib/codex-subscription-credentials.ts";
import { isTaskSessionId } from "../src/lib/task-session-id.ts";

const { values } = parseArgs({ options: {
  session: { type: "string" }, owner: { type: "string" }, "repository-id": { type: "string" }, "auth-file": { type: "string" },
} });
const { session, owner } = values;
const filename = values["auth-file"];
const repositoryId = Number(values["repository-id"]);
if (!session || !isTaskSessionId(session) || !owner || !filename || !path.isAbsolute(filename) || !Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
  throw new Error("Explicit task, owner login, repository ID and absolute auth-file path are required.");
}
const relative = path.relative(process.cwd(), filename);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Credentials must remain outside the repository.");
const info = await stat(filename);
if (!info.isFile() || info.size > 32_768 || (info.mode & 0o077)) throw new Error("Auth file must be private (0600), bounded and regular.");
let raw;
try { raw = JSON.parse(await readFile(filename, "utf8")); } catch { throw new Error("Auth file is unavailable or invalid."); }
const auth = parseManagedCodexAuth(raw);
if (codexAuthNeedsRefresh(auth)) throw new Error("Use a current native login; do not seed an expired credential.");
const secret = process.env.HIVE_CODEX_AUTH_SECRET?.trim() ?? "";
if (secret.length < 32 || !process.env.DATABASE_URL) throw new Error("The target database and credential encryption must be explicitly configured.");
const url = new URL(process.env.DATABASE_URL);
if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
try {
  await client.connect(); await client.query("BEGIN");
  const { rows } = await client.query(`SELECT t.id, t.created_by, t.repository, t.stage, t.workspace->'restore' AS restore,
    u.github_login FROM task_sessions t JOIN users u ON u.id = t.created_by WHERE t.id = $1 FOR UPDATE OF t`, [session]);
  const task = rows[0];
  if (!task || task.github_login.toLowerCase() !== owner.toLowerCase() || task.repository?.id !== repositoryId || task.repository.visibility !== "private") {
    throw new Error("The task owner or private repository does not match the authorized binding.");
  }
  if (task.stage === "running" || task.restore) throw new Error("Wait until the task and workspace restoration are idle.");
  const binding = { accountHash: codexAccountHash(auth), sessionId: session, ownerId: task.created_by, repositoryId };
  const encrypted = await sealCodexAuth(auth, binding, secret);
  const inserted = await client.query(`INSERT INTO codex_subscriptions (account_hash, session_id, owner_id, repository_id, encrypted_auth)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING session_id`, [binding.accountHash, session, binding.ownerId, repositoryId, encrypted]);
  if (!inserted.rowCount) throw new Error("An account/task binding already exists; never overwrite it with an older login seed.");
  await client.query("COMMIT");
  console.log(`Bound credentials to ${session}. Native refresh is now owned by Hive; do not reuse the seed login.`);
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  // Database/SDK errors can include parameter values. Do not echo them.
  console.error("Binding was not applied. Check the target scope, idle state, migration and existing binding; no credentials were printed.");
  process.exitCode = 1;
} finally { await client.end(); }
