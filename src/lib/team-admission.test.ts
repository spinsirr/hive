import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { safeReturnTo } from "./return-to.ts";
import { signSessionInvite, verifySessionInvite } from "./session-invite-token.ts";
import { requireTeamAdmission, TeamInviteRequiredError } from "./team-admission.ts";

const NOW = 1_788_550_000_000;
const SECRET = "local-test-invitation-key-not-a-production-secret";
const TASK = "shared-task";
const OWNER = 101;
const NEW_MEMBER = 202;
const token = signSessionInvite(TASK, SECRET, NOW);
const invitePath = `/sessions/${TASK}?invite=${encodeURIComponent(token)}`;

// Only persistence and GitHub ownership are simulated. Admission uses the actual
// URL parser, task-ID validation, HMAC verification, and expiry checks.
function admissionChecks(options: { member?: boolean; taskExists?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    isTeamMember: async (githubUserId: number) => {
      calls.push(`member:${githubUserId}`);
      return options.member ?? false;
    },
    isAppOwner: async (githubUserId: number) => {
      calls.push(`owner:${githubUserId}`);
      return githubUserId === OWNER;
    },
    sessionExists: async (sessionId: string) => {
      calls.push(`task:${sessionId}`);
      return sessionId === TASK && (options.taskExists ?? true);
    },
    verifyInvite: (sessionId: string, invite: string) =>
      verifySessionInvite(sessionId, invite, SECRET, NOW),
  };
}

test("GitHub authentication alone does not admit a new team member", async () => {
  const checks = admissionChecks();
  await assert.rejects(
    requireTeamAdmission(NEW_MEMBER, "/", checks),
    TeamInviteRequiredError,
  );
  assert.deepEqual(checks.calls, [`member:${NEW_MEMBER}`, `owner:${NEW_MEMBER}`]);
});

test("an existing member can sign in without another invitation or owner lookup", async () => {
  const checks = admissionChecks({ member: true });
  await requireTeamAdmission(NEW_MEMBER, "/", checks);
  assert.deepEqual(checks.calls, [`member:${NEW_MEMBER}`]);
});

test("only the verified App owner can bootstrap membership without an invitation", async () => {
  const checks = admissionChecks();
  await requireTeamAdmission(OWNER, "/", checks);
  assert.deepEqual(checks.calls, [`member:${OWNER}`, `owner:${OWNER}`]);
});

test("a valid signed invitation to an existing task admits a new member", async () => {
  const checks = admissionChecks();
  await requireTeamAdmission(NEW_MEMBER, invitePath, checks);
  assert.deepEqual(checks.calls, [`member:${NEW_MEMBER}`, `task:${TASK}`]);
});

test("an invitation cannot admit someone after its target task is deleted", async () => {
  await assert.rejects(
    requireTeamAdmission(NEW_MEMBER, invitePath, admissionChecks({ taskExists: false })),
    TeamInviteRequiredError,
  );
});

test("missing, forged, expired, mis-scoped and ambiguous invitations are denied", async () => {
  const badPaths = [
    `/sessions/${TASK}`,
    `/sessions/${TASK}?invite=`,
    `/sessions/${TASK}?invite=forged`,
    `/sessions/${TASK}?invite=${token}.`,
    `/sessions/${TASK}?invite=${signSessionInvite(TASK, "another-secret", NOW)}`,
    `/sessions/${TASK}?invite=${signSessionInvite(TASK, SECRET, NOW - 8 * 86_400_000)}`,
    `/sessions/another-task?invite=${token}`,
    `${invitePath}&invite=${token}`,
    `/sessions/${TASK}#invite=${token}`,
    `/api/sessions/${TASK}?invite=${token}`,
    `/sessions/${TASK}%2Fextra?invite=${token}`,
    `https://elsewhere.example${invitePath}`,
    `//elsewhere.example${invitePath}`,
    `/\\elsewhere.example${invitePath}`,
  ];
  for (const path of badPaths) {
    const checks = admissionChecks();
    await assert.rejects(requireTeamAdmission(NEW_MEMBER, path, checks), TeamInviteRequiredError);
    assert.equal(checks.calls.some((call) => call.startsWith("task:")), false);
  }
});

test("an installation callback is not an alternative admission path", async () => {
  await assert.rejects(
    requireTeamAdmission(
      NEW_MEMBER,
      `/sessions/${TASK}?github=connected&installation_id=123`,
      admissionChecks(),
    ),
    TeamInviteRequiredError,
  );
});

test("membership, task and owner lookup failures fail closed", async () => {
  const unavailable = async () => { throw new Error("Lookup unavailable"); };
  for (const [path, checks] of [
    ["/", { ...admissionChecks(), isTeamMember: unavailable }],
    [invitePath, { ...admissionChecks(), sessionExists: unavailable }],
    ["/", { ...admissionChecks(), isAppOwner: unavailable }],
  ] as const) {
    await assert.rejects(requireTeamAdmission(NEW_MEMBER, path, checks), /Lookup unavailable/);
  }
});

test("invalid GitHub IDs are rejected before any external lookup", async () => {
  for (const id of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const checks = admissionChecks({ member: true });
    await assert.rejects(requireTeamAdmission(id, invitePath, checks), TeamInviteRequiredError);
    assert.deepEqual(checks.calls, []);
  }
});

test("existing seven-day invitation tokens retain their signature and expiry", () => {
  const payload = Buffer.from(JSON.stringify({
    sessionId: TASK,
    expiresAt: NOW + 7 * 86_400_000,
  })).toString("base64url");
  const existingToken = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
  assert.equal(token, existingToken);
  assert.equal(verifySessionInvite(TASK, existingToken, SECRET, NOW), true);
  assert.equal(verifySessionInvite(TASK, existingToken, SECRET, NOW + 7 * 86_400_000 + 1), false);
  assert.equal(verifySessionInvite("other-task", existingToken, SECRET, NOW), false);
});

test("malformed signed invitation payloads and extra segments are rejected", () => {
  for (const value of [null, {}, { sessionId: TASK }, { sessionId: TASK, expiresAt: "forever" }]) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signed = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    assert.equal(verifySessionInvite(TASK, signed, SECRET, NOW), false);
  }
  for (const invalid of [null, undefined, "", token + ".", token + ".extra", token + "x"]) {
    assert.equal(verifySessionInvite(TASK, invalid, SECRET, NOW), false);
  }
});

test("OAuth return paths stay local even after URL normalization", () => {
  for (const value of [
    null, undefined, 123, {}, "", "https://elsewhere.example", "//elsewhere.example",
    "/\\elsewhere.example", "/\t/elsewhere.example", "/.//elsewhere.example",
    "/%2e//elsewhere.example", "/a/..//elsewhere.example",
  ]) {
    assert.equal(safeReturnTo(value), "/");
  }
  assert.equal(safeReturnTo(invitePath), invitePath);
  assert.equal(safeReturnTo(`/sessions/${TASK}?github=connected`), `/sessions/${TASK}?github=connected`);
  assert.equal(safeReturnTo("/sessions/old/../shared-task"), "/sessions/shared-task");
});
