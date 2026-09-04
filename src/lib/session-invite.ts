import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function inviteSecret() {
  const secret =
    process.env.HIVE_INVITE_SECRET?.trim() ||
    process.env.GITHUB_APP_CLIENT_SECRET?.trim() ||
    (process.env.NODE_ENV === "development"
      ? "hive-local-development-invite-secret"
      : undefined);
  if (!secret) throw new Error("HIVE_INVITE_SECRET is not configured.");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", inviteSecret())
    .update(payload)
    .digest("base64url");
}

export function createSessionInviteToken(
  sessionId: string,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({ sessionId, expiresAt: now + INVITE_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySessionInviteToken(
  sessionId: string,
  token?: string | null,
) {
  if (!token) return false;
  const [payload, receivedSignature, extra] = token.split(".");
  if (!payload || !receivedSignature || extra) return false;
  const expected = Buffer.from(signature(payload));
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return false;
  }

  try {
    const invite = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sessionId?: unknown; expiresAt?: unknown };
    return (
      invite.sessionId === sessionId &&
      typeof invite.expiresAt === "number" &&
      Number.isFinite(invite.expiresAt) &&
      invite.expiresAt >= Date.now()
    );
  } catch {
    return false;
  }
}
