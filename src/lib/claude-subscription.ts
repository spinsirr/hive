/** Deployment-owned credential. Never discover another application's local login. */
export function claudeSubscriptionToken(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const token = env.HIVE_CLAUDE_OAUTH_TOKEN?.trim();
  if (!token) return undefined;
  if (!/^sk-ant-oat01-[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Reconnect the Claude subscription before running this task.");
  }
  return token;
}
