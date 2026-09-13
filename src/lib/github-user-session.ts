import "server-only";

import { createHash, hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

// Separate from the Hive login: this grants only live GitHub repository discovery.
// It is encrypted, HttpOnly, and bound to one database-backed Hive login token.
export const GITHUB_USER_COOKIE = "hive_github_user";
export const GITHUB_USER_MAX_AGE = 8 * 60 * 60;
const AUDIENCE = "hive-github-repositories";

function encryptionKey() {
  const secret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!secret)
    throw new Error("GitHub App OAuth credentials are not configured.");
  return new Uint8Array(hkdfSync("sha256", secret, "hive", AUDIENCE, 32));
}

function loginBinding(sessionToken: string) {
  return createHash("sha256").update(sessionToken).digest("hex");
}

export async function sealGitHubUserToken(
  accessToken: string,
  sessionToken: string,
  maxAge: number
) {
  return new EncryptJWT({ accessToken })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience(AUDIENCE)
    .setSubject(loginBinding(sessionToken))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .encrypt(encryptionKey());
}

export async function readGitHubUserToken(
  encrypted?: string,
  sessionToken?: string
) {
  if (!encrypted || !sessionToken) return null;
  try {
    const { payload } = await jwtDecrypt(encrypted, encryptionKey(), {
      audience: AUDIENCE,
      subject: loginBinding(sessionToken),
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["exp", "iat", "sub", "aud"],
    });
    return typeof payload.accessToken === "string" && payload.accessToken
      ? payload.accessToken
      : null;
  } catch {
    return null;
  }
}

export function githubUserCookieOptions(
  secure: boolean,
  maxAge = GITHUB_USER_MAX_AGE
) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/api/github",
    maxAge,
  };
}
