// Read timing evidence from an isolated copy of an explicitly selected QA
// snapshot. Never resumes or changes the original task; never calls a model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

assert.ok(process.argv.includes("--live"), "Pass --live for a temporary diagnostic sandbox.");
const snapshotId = process.argv.find(value => value.startsWith("snap_"));
assert.match(snapshotId ?? "", /^snap_[a-zA-Z0-9]+$/);
const value = flag => process.argv[process.argv.indexOf(flag) + 1];
for (const flag of ["--since", "--until"]) assert.ok(process.argv.includes(flag), `${flag} is required`);
const since = Date.parse(value("--since")), until = Date.parse(value("--until"));
assert.ok(Number.isFinite(since) && Number.isFinite(until) && since < until, "Provide a valid time interval.");
for (const name of ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"]) assert.ok(process.env[name], `${name} is required`);
const sandbox = await Sandbox.create({
  token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID,
  name: `hive-qa-latency-${randomUUID()}`, source: { type: "snapshot", snapshotId }, timeout: 120_000,
});
let report;
try {
  // Names/sizes only: no credentials, prompt text or private reasoning output.
  const result = await sandbox.runCommand({ cmd: "node", args: ["-e", `
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const since = ${since}, until = ${until};
    const roots = ['/vercel/sandbox/.agent-runs', path.join(os.homedir(), '.codex')];
    const files = [];
    function walk(dir, depth) {
      if (depth > 5 || !fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, depth + 1);
        else if (/\\.(log|jsonl|sqlite)$/.test(entry.name)) files.push({path:file, bytes:fs.statSync(file).size});
      }
    }
    roots.forEach(root => walk(root, 0));
    const logs = files.find(file => file.path.endsWith('/logs_2.sqlite'));
    if (!logs) throw new Error('This snapshot has no supported native diagnostic log.');
    let transport = [];
    if (logs) {
      const {DatabaseSync} = require('node:sqlite');
      const db = new DatabaseSync(logs.path, {readOnly:true});
      const rows = db.prepare('SELECT ts,ts_nanos,level,target,feedback_log_body FROM logs WHERE ts BETWEEN ? AND ? ORDER BY ts,ts_nanos').all(Math.floor(since / 1000), Math.ceil(until / 1000));
      // Safelisted classifications only, never raw native log text.
      transport = rows.flatMap(row => {
        const atMs = row.ts * 1000 + row.ts_nanos / 1e6;
        if (atMs < since || atMs > until) return [];
        const at = new Date(atMs).toISOString();
        const body = row.feedback_log_body ?? '';
        if (row.target === 'codex_api::endpoint::responses_websocket' && row.level === 'ERROR') {
          return [{at,kind:'websocket-error',reason:body.includes('Attack attempt detected') ? 'Attack attempt detected' : 'details omitted'}];
        }
        if (row.target === 'codex_core::responses_retry') {
          const retry = body.match(/retrying sampling request \\((\\d+)\\/(\\d+) in ([\\d.]+)(ms|s)\\)/);
          return retry ? [{at,kind:'retry',attempt:Number(retry[1]),maxRetries:Number(retry[2]),delayMs:Number(retry[3]) * (retry[4] === 's' ? 1000 : 1)}] : [];
        }
        if (row.target === 'codex_core::client' && body.includes('falling back to HTTP')) return [{at,kind:'http-fallback'}];
        return [];
      });
      db.close();
    }
    const nativeEvents = [];
    for (const file of files.filter(file => file.path.endsWith('.jsonl'))) {
      const events = fs.readFileSync(file.path,'utf8').split('\\n').flatMap(line => {
        try {
          const event = JSON.parse(line);
          const time = Date.parse(event.timestamp), kind = event.payload?.type;
          if (!Number.isFinite(time) || time < since || time > until) return [];
          if (!['task_started','user_message','agent_message','task_complete'].includes(kind)) return [];
          return [{at:event.timestamp,kind}];
        } catch { return []; }
      });
      nativeEvents.push(...events);
    }
    console.log(JSON.stringify({transport,nativeEvents:nativeEvents.sort((a,b) => a.at.localeCompare(b.at))}));
  `] });
  assert.equal(result.exitCode, 0);
  report = JSON.parse(await result.stdout());
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await sandbox.stop(); }
  finally { await sandbox.delete({ deleteOrphanSnapshots: true }); }
  console.log("Removed only the diagnostic copy; the original task and snapshot were retained.");
}
assert.ok(report.nativeEvents.length, "No native turn events found in this interval.");
if (process.argv.includes("--assert-http-only")) {
  assert.equal(report.transport.filter(event => event.kind === "websocket-error").length, 0,
    "Brokered HTTP transport must not spend first-response time on failing WebSocket attempts.");
}
