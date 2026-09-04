const TASK_SESSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function isTaskSessionId(value: unknown): value is string {
  return typeof value === "string" && TASK_SESSION_ID_PATTERN.test(value);
}
