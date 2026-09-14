import { createHash, hkdfSync } from "node:crypto";
import { decodeJwt, EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

const audience = "hive-codex-subscription";
const authSchema = z
  .object({
    auth_mode: z.literal("chatgpt"),
    OPENAI_API_KEY: z.null().optional(),
    tokens: z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1),
        id_token: z.string().min(1),
        account_id: z.string().min(1),
      })
      .passthrough(),
    last_refresh: z.string().min(1),
  })
  .passthrough();
export type ManagedCodexAuth = z.infer<typeof authSchema>;
// Immutable enrollment provenance authenticates the stored envelope, not callers.
export type SubscriptionBinding = {
  accountHash: string;
  sessionId: string;
  ownerId: string;
  repositoryId: number;
};

export function parseManagedCodexAuth(value: unknown): ManagedCodexAuth {
  const parsed = authSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(value).length > 32_768)
    throw new Error("A managed Codex subscription login is required.");
  return parsed.data;
}

export function codexAccountHash(auth: ManagedCodexAuth) {
  return createHash("sha256").update(auth.tokens.account_id).digest("hex");
}

function key(secret: string) {
  if (secret.length < 32)
    throw new Error("Subscription credential encryption is not configured.");
  return new Uint8Array(hkdfSync("sha256", secret, "hive", audience, 32));
}
function subject(binding: SubscriptionBinding) {
  return JSON.stringify([
    binding.accountHash,
    binding.sessionId,
    binding.ownerId,
    binding.repositoryId,
  ]);
}
export async function sealCodexAuth(
  auth: ManagedCodexAuth,
  binding: SubscriptionBinding,
  secret: string
) {
  if (codexAccountHash(auth) !== binding.accountHash)
    throw new Error("Subscription account mismatch.");
  return new EncryptJWT({ auth })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience(audience)
    .setSubject(subject(binding))
    .setIssuedAt()
    .encrypt(key(secret));
}
export async function openCodexAuth(
  encrypted: string,
  binding: SubscriptionBinding,
  secret: string
) {
  try {
    const { payload } = await jwtDecrypt(encrypted, key(secret), {
      audience,
      subject: subject(binding),
      requiredClaims: ["aud", "sub", "iat"],
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const auth = parseManagedCodexAuth(payload.auth);
    if (codexAccountHash(auth) !== binding.accountHash)
      throw new Error("mismatch");
    return auth;
  } catch {
    throw new Error("The Codex subscription needs to be reconnected.");
  }
}

// Expiry is a cache hint, never an authorization decision. The credential came
// from the authenticated vault; the native service still validates its token.
export function codexAuthNeedsRefresh(
  auth: ManagedCodexAuth,
  now = Date.now()
) {
  try {
    const payload = decodeJwt(auth.tokens.access_token);
    const refreshed = Date.parse(auth.last_refresh);
    return (
      !Number.isFinite(refreshed) ||
      now - refreshed > 7 * 86_400_000 ||
      typeof payload.exp !== "number" ||
      payload.exp * 1000 < now + 15 * 60_000
    );
  } catch {
    return true;
  }
}

export function externalCodexTokens(auth: ManagedCodexAuth) {
  return {
    accessToken: auth.tokens.access_token,
    chatgptAccountId: auth.tokens.account_id,
  };
}
