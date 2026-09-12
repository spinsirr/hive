import { CODEX_SUBSCRIPTION_MODEL, codexModel, codingModelOptions } from "./coding-models.ts";

/** Deployment-owned authentication, independent of task membership or repository. */
export function usesPlatformSubscriptions(env: Readonly<Record<string, string | undefined>>) {
  return Boolean(env.HIVE_CODEX_AUTH_SECRET?.trim() || env.HIVE_CLAUDE_OAUTH_TOKEN?.trim());
}

export function platformCodingModels(env: Readonly<Record<string, string | undefined>>) {
  const subscription = usesPlatformSubscriptions(env);
  // A disconnected credential must not silently change models or billing mode.
  return codingModelOptions(subscription ? CODEX_SUBSCRIPTION_MODEL : codexModel(env.HIVE_CODEX_MODEL), subscription);
}
