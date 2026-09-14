import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isTaskSessionId } from "./task-session-id.ts";

const claims = z
  .object({
    audience: z.literal("hive-agent-tools"),
    sessionId: z.string().refine(isTaskSessionId),
    memberId: z.string().min(1).max(120),
    runId: z.string().min(1).max(120),
    expiresAt: z.number().int(),
  })
  .strict();
export type HiveToolScope = Pick<
  z.infer<typeof claims>,
  "sessionId" | "memberId" | "runId"
>;

const lifetime = 5 * 60_000;
function sign(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`hive-agent-tools:${payload}`)
    .digest();
}

export function createHiveToolToken(
  scope: HiveToolScope,
  secret: string,
  now = Date.now()
) {
  if (!secret) throw new Error("Agent tool signing is not configured.");
  const payload = Buffer.from(
    JSON.stringify(
      claims.parse({
        ...scope,
        audience: "hive-agent-tools",
        expiresAt: now + lifetime,
      })
    )
  ).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function verifyHiveToolToken(
  token: string,
  sessionId: string,
  secret: string,
  now = Date.now()
): HiveToolScope | null {
  if (!secret || token.length > 2000) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(payload, secret),
    received = Buffer.from(signature, "base64url");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return null;
  try {
    const parsed = claims.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    );
    if (
      parsed.sessionId !== sessionId ||
      parsed.expiresAt <= now ||
      parsed.expiresAt > now + lifetime
    )
      return null;
    return {
      sessionId: parsed.sessionId,
      memberId: parsed.memberId,
      runId: parsed.runId,
    };
  } catch {
    return null;
  }
}

/** The destination is deployment configuration, never a client-controlled Host header. */
export function hiveToolEndpoint(sessionId: string, callbackUrl: string) {
  const url = new URL(callbackUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error("Agent tools require HTTPS outside local development.");
  }
  return new URL(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-tools`,
    url.origin
  ).toString();
}
