"use client";

import { formatMessageTime } from "@/lib/message-time";

/** Local-time label. Server and browser zones differ, so hydration mismatches are expected here. */
export function MessageTime({ message, className }: {
  message: { time: string; createdAt?: number };
  className?: string;
}) {
  return (
    <time
      className={className}
      dateTime={typeof message.createdAt === "number" ? new Date(message.createdAt).toISOString() : undefined}
      suppressHydrationWarning
    >
      {formatMessageTime(message)}
    </time>
  );
}
