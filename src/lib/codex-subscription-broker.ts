import { randomUUID } from "node:crypto";
import type { HarnessV1RequestTransformation } from "@ai-sdk/harness";

export type CodexAccess = { accessToken: string; chatgptAccountId: string };

/** JWT-shaped, deliberately unauthentic placeholder accepted by native external auth. */
export function codexAccessPlaceholder(auth: CodexAccess): CodexAccess {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 900,
    "https://api.openai.com/auth": { chatgpt_account_id: auth.chatgptAccountId },
  })).toString("base64url");
  return { accessToken: `e30.${payload}.${Buffer.from(randomUUID()).toString("base64url")}`, chatgptAccountId: auth.chatgptAccountId };
}

/** No account management, cloud tasks, arbitrary paths, or off-host credential use. */
export function codexOAuthTransformations(auth: CodexAccess, placeholder: CodexAccess): HarnessV1RequestTransformation[] {
  return [
    { path: "/backend-api/codex/responses", method: ["POST", "GET"] },
    { path: "/backend-api/codex/responses/compact", method: ["POST"] },
    { path: "/backend-api/codex/models", method: ["GET"] },
    { path: "/backend-api/wham/usage", method: ["GET"] },
  ].map(({ path, method }) => ({
    match: { host: "chatgpt.com", path: { exact: path }, method,
      headers: [{ key: { exact: "authorization" }, value: { exact: `Bearer ${placeholder.accessToken}` } }],
    },
    transform: { headers: { Authorization: `Bearer ${auth.accessToken}`, "ChatGPT-Account-Id": auth.chatgptAccountId } },
  }));
}
