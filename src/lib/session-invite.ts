import "server-only";

import { signSessionInvite, verifySessionInvite } from "@/lib/session-invite-token";

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

export function createSessionInviteToken(
  sessionId: string,
  now = Date.now(),
) {
  return signSessionInvite(sessionId, inviteSecret(), now);
}

export function verifySessionInviteToken(
  sessionId: string,
  token?: string | null,
) {
  if (!token) return false;
  return verifySessionInvite(sessionId, token, inviteSecret());
}
