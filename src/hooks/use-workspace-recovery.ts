"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  assign,
  createActor,
  fromPromise,
  setup,
  type ActorRefFrom,
} from "xstate";
import { useHiveClient } from "@/components/hive/hive-client";
import type { WorkspaceRestore } from "@/lib/session/task-session";
import type { TaskSessionSnapshot } from "@/lib/session/task-session-contract";

type RecoveryInput = {
  delay: number;
  confirm: (signal: AbortSignal) => Promise<TaskSessionSnapshot | null>;
  receive: (snapshot: TaskSessionSnapshot) => void;
};

const recoveryMachine = setup({
  types: {
    context: {} as RecoveryInput & {
      attempts: number;
      notice: string;
      failure: string;
    },
    input: {} as RecoveryInput,
    events: {} as { type: "CHECK" },
  },
  actors: {
    confirm: fromPromise<TaskSessionSnapshot | null, RecoveryInput>(
      ({ input, signal }) => input.confirm(signal)
    ),
  },
  delays: { initialDelay: ({ context }) => context.delay },
}).createMachine({
  context: ({ input }) => ({ ...input, attempts: 0, notice: "", failure: "" }),
  initial: "waiting",
  on: {
    CHECK: {
      target: ".checking",
      reenter: true,
      actions: assign({ attempts: 0, notice: "", failure: "" }),
    },
  },
  states: {
    waiting: { after: { initialDelay: "checking" } },
    checking: {
      entry: assign({
        attempts: ({ context }) => context.attempts + 1,
        notice: "",
      }),
      invoke: {
        src: "confirm",
        input: ({ context }) => context,
        onDone: [
          {
            guard: ({ event }) => event.output !== null,
            target: "confirmed",
            actions: ({ context, event }) => {
              if (event.output) context.receive(event.output);
            },
          },
          {
            target: "retrying",
            actions: assign({
              failure: "",
              notice:
                "Checking automatically. You can keep reading; editing will return when recovery is confirmed.",
            }),
          },
        ],
        onError: {
          target: "retrying",
          actions: assign({
            notice:
              "Confirmation is taking longer than usual. Checking again automatically; you can keep reading.",
            failure: ({ event }) =>
              event.error instanceof Error &&
              event.error.name !== "TimeoutError"
                ? event.error.message
                : "Status is temporarily unavailable. Check again to confirm recovery.",
          }),
        },
      },
    },
    retrying: {
      always: {
        guard: ({ context }) => context.attempts >= 18,
        target: "unavailable",
        actions: assign({
          notice: ({ context }) =>
            context.failure ||
            "This is taking longer than usual. Check status again before retrying the same checkpoint.",
        }),
      },
      after: { 10000: "checking" },
    },
    unavailable: {},
    confirmed: { type: "final" },
  },
});

/** Task-owned recovery: changing workspace tabs must not stop confirmation. */
export function useWorkspaceRecovery(
  sessionId: string,
  revision: number,
  restore: WorkspaceRestore | undefined,
  onRestored: (snapshot: TaskSessionSnapshot) => void
) {
  const client = useHiveClient();
  const actorRef = useRef<ActorRefFrom<typeof recoveryMachine> | null>(null);
  const { id, snapshotId, startedAt, retryAfter } = restore ?? {};
  const key = JSON.stringify([
    sessionId,
    id,
    snapshotId,
    startedAt,
    retryAfter,
  ]);
  const [state, setState] = useState<{
    key: string;
    checking: boolean;
    notice: string;
  }>();
  const currentVersion = useEffectEvent(() => revision);
  const receive = useEffectEvent(onRestored);
  const check = useCallback(
    () => actorRef.current?.send({ type: "CHECK" }),
    []
  );

  useEffect(() => {
    if (!id || !snapshotId || retryAfter === undefined) return;
    const actor = createActor(recoveryMachine, {
      input: {
        delay: Math.min(3_000, Math.max(0, retryAfter - Date.now())),
        receive: (snapshot) => receive(snapshot),
        async confirm(signal) {
          const response = await client.request(
            `/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "check",
                id,
                snapshotId,
                version: currentVersion(),
              }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
            }
          );
          const body = await response.json();
          if (response.status === 200) return body;
          if (response.status === 202) return null;
          throw new Error(
            body.error ||
              "Restore status could not be checked. Try checking again."
          );
        },
      },
    });
    const subscription = actor.subscribe((snapshot) =>
      setState({
        key,
        checking: snapshot.matches("checking"),
        notice: snapshot.context.notice,
      })
    );
    actorRef.current = actor;
    actor.start();
    return () => {
      subscription.unsubscribe();
      actor.stop();
      actorRef.current = null;
    };
  }, [client, sessionId, id, snapshotId, retryAfter, key]);

  return {
    checking: state?.key === key && state.checking,
    notice: state?.key === key ? state.notice : "",
    check,
  };
}

export type WorkspaceRecoveryStatus = ReturnType<typeof useWorkspaceRecovery>;
