import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { safeReturnTo } from "../auth/return-to.ts";
import {
  signSessionInvite,
  verifySessionInvite,
} from "./session-invite-token.ts";

const NOW = 1_788_550_000_000;
const SECRET = "local-test-invitation-key-not-a-production-secret";
const TASK = "shared-task";
const token = signSessionInvite(TASK, SECRET, NOW);
const invitePath = `/sessions/${TASK}?invite=${encodeURIComponent(token)}`;

test("existing seven-day invitation tokens retain their signature and expiry", () => {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId: TASK,
      expiresAt: NOW + 7 * 86_400_000,
    })
  ).toString("base64url");
  const existingToken = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
  assert.equal(token, existingToken);
  assert.equal(verifySessionInvite(TASK, existingToken, SECRET, NOW), true);
  assert.equal(
    verifySessionInvite(TASK, existingToken, SECRET, NOW + 7 * 86_400_000 + 1),
    false
  );
  assert.equal(
    verifySessionInvite("other-task", existingToken, SECRET, NOW),
    false
  );
});

test("malformed signed invitation payloads and extra segments are rejected", () => {
  for (const value of [
    null,
    {},
    { sessionId: TASK },
    { sessionId: TASK, expiresAt: "forever" },
  ]) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signed = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    assert.equal(verifySessionInvite(TASK, signed, SECRET, NOW), false);
  }
  for (const invalid of [
    null,
    undefined,
    "",
    token + ".",
    token + ".extra",
    token + "x",
  ]) {
    assert.equal(verifySessionInvite(TASK, invalid, SECRET, NOW), false);
  }
});

test("OAuth return paths stay local even after URL normalization", () => {
  for (const value of [
    null,
    undefined,
    123,
    {},
    "",
    "https://elsewhere.example",
    "//elsewhere.example",
    "/\\elsewhere.example",
    "/\t/elsewhere.example",
    "/.//elsewhere.example",
    "/%2e//elsewhere.example",
    "/a/..//elsewhere.example",
  ]) {
    assert.equal(safeReturnTo(value), "/");
  }
  assert.equal(safeReturnTo(invitePath), invitePath);
  assert.equal(
    safeReturnTo(`/sessions/${TASK}?github=connected`),
    `/sessions/${TASK}?github=connected`
  );
  assert.equal(
    safeReturnTo("/sessions/old/../shared-task"),
    "/sessions/shared-task"
  );
});
