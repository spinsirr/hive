import { createHmac } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { subagentControlSchema, subagentSchema, type SubagentControl, type SubagentSession } from "./hive-subagents.ts";
import { createAgentSessionId } from "./task-session.ts";
import { resolvePersistentSandboxName } from "./hive-sandbox.ts";

export function subagentCapability(sessionId: string, runId: string, secret: string) {
  if (!secret) throw new Error("Agent control is not configured.");
  return createHmac("sha256", secret).update(JSON.stringify(["hive-subagents", sessionId, runId])).digest("hex");
}

// Constant executable; user/model inputs are data, never interpolated commands.
const client = `
const {createConnection}=require('node:net');
const {createHash}=require('node:crypto');
const capability=process.env.HIVE_CONTROL;
const socket=createConnection('/tmp/hive-'+createHash('sha256').update(capability).digest('hex').slice(0,32)+'.sock');
let body='';
socket.setEncoding('utf8');
socket.setTimeout(14000,()=>socket.destroy(new Error('Control timed out')));
socket.on('connect',()=>socket.write(JSON.stringify({...JSON.parse(process.env.HIVE_CONTROL_INPUT),capability})+'\\n'));
socket.on('data',chunk=>{body+=chunk;if(body.length>32768)socket.destroy(new Error('Invalid response'));});
socket.on('end',()=>process.stdout.write(body));
socket.on('error',()=>{process.stderr.write('Subagent control is unavailable');process.exitCode=1;});
`;

export function assertSubagentRun(session: SubagentSession, runId: string) {
  if (!session.repository || session.stage !== "running" || session.workspace.startedAt == null || session.workspace.completedAt != null || session.workspace.restore || session.workspace.liveReply?.id !== runId) throw new Error("This run has ended. Refresh the task.");
}

export async function controlSubagent(session: SubagentSession, runId: string, input: SubagentControl, signal: AbortSignal) {
  assertSubagentRun(session, runId);
  const parsed = subagentControlSchema.parse(input);
  const agentId = session.workspace.agentSession?.id ?? createAgentSessionId(session.sessionId, session.repository!.connectedAt);
  // Never create/resume a stopped VM or start another parent run from a control.
  const sandbox = await Sandbox.get({ name: resolvePersistentSandboxName(session, agentId), resume: false, signal });
  if (sandbox.tags?.session !== session.sessionId) throw new Error("Workspace does not belong to this task.");
  const result = await sandbox.runCommand({ cmd: "node", args: ["-e", client], env: {
    HIVE_CONTROL: subagentCapability(session.sessionId, runId, process.env.HIVE_INVITE_SECRET?.trim() ?? ""),
    HIVE_CONTROL_INPUT: JSON.stringify(parsed),
  }, signal, timeoutMs: 15_000 });
  if (result.exitCode !== 0) throw new Error("Subagent control is unavailable. No new run was started.");
  const response = JSON.parse(await result.stdout({ signal }));
  if (response.error) throw new Error("The subagent request was not accepted. Check its current state.");
  const task = subagentSchema.parse(response.result);
  if (task.runId !== runId || (parsed.action !== "spawn" && task.id !== parsed.id)) throw new Error("Subagent response does not belong to this request.");
  return task;
}
