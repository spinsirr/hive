import { createHmac, timingSafeEqual } from "node:crypto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSessionInvite(
  sessionId: string,
  secret: string,
  now = Date.now()
) {
  const payload = Buffer.from(
    JSON.stringify({ sessionId, expiresAt: now + INVITE_TTL_MS })
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionInvite(
  sessionId: string,
  token: string | null | undefined,
  secret: string,
  now = Date.now()
) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, receivedSignature] = parts;
  if (!payload || !receivedSignature) return false;
  const expected = Buffer.from(signature(payload, secret));
  const received = Buffer.from(receivedSignature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return false;
  }

  try {
    const invite = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { sessionId?: unknown; expiresAt?: unknown };
    return (
      invite.sessionId === sessionId &&
      typeof invite.expiresAt === "number" &&
      Number.isFinite(invite.expiresAt) &&
      invite.expiresAt >= now
    );
  } catch {
    return false;
  }
}
