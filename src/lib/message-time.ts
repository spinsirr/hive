/**
 * Messages store `createdAt` (epoch ms) so every viewer sees their own local
 * time. Older messages only have the server-zone `time` label, which is shown
 * unchanged rather than guessed.
 */
export function formatMessageTime(
  message: { time: string; createdAt?: number },
  options: { locale?: string; timeZone?: string } = {},
) {
  if (typeof message.createdAt !== "number" || !Number.isFinite(message.createdAt)) return message.time;
  return new Intl.DateTimeFormat(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(message.createdAt);
}
