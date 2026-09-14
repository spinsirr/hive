"use client";

import { useSyncExternalStore } from "react";

import { formatMessageTime } from "@/lib/conversation/message-time";

// Message timestamps do not tick; prop changes and hydration refresh the label.
const subscribe = () => () => {};

export function MessageTime({
  message,
  className,
}: {
  message: { time: string; createdAt?: number };
  className?: string;
}) {
  // Match the serialized label during hydration, then read the viewer's locale.
  // Suppressing a mismatch instead would leave the server's text in the DOM.
  const label = useSyncExternalStore(
    subscribe,
    () => formatMessageTime(message),
    () => message.time
  );

  return (
    <time
      className={className}
      dateTime={
        typeof message.createdAt === "number"
          ? new Date(message.createdAt).toISOString()
          : undefined
      }
    >
      {label}
    </time>
  );
}
