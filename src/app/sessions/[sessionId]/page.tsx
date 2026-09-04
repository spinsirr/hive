import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { HiveSignIn } from "@/components/hive/hive-sign-in";
import { HiveWorkspace } from "@/components/hive/hive-workspace";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isTaskSessionId } from "@/lib/task-session-id";
import { publicTaskSessionSnapshot } from "@/lib/task-session-snapshot";
import {
  getTaskSessionSnapshot,
  isTaskSessionMember,
  joinTaskSession,
  taskSessionExists,
} from "@/lib/task-session-store";
import {
  createSessionInviteToken,
  verifySessionInviteToken,
} from "@/lib/session-invite";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { sessionId } = await params;
  const { invite } = await searchParams;
  if (!isTaskSessionId(sessionId) || !(await taskSessionExists(sessionId))) notFound();

  const cookieStore = await cookies();
  const member = await getSessionMember(
    cookieStore.get(HIVE_SESSION_COOKIE)?.value,
  );

  const cleanReturnTo = `/sessions/${sessionId}`;
  const returnTo = invite
    ? `${cleanReturnTo}?invite=${encodeURIComponent(invite)}`
    : cleanReturnTo;
  if (!member) {
    return (
      <HiveSignIn
        description="Join your teammate and steer the same task-scoped coding agent."
        returnTo={returnTo}
        title="Join this task"
      />
    );
  }

  if (!(await isTaskSessionMember(sessionId, member.id))) {
    if (!verifySessionInviteToken(sessionId, invite)) notFound();
    await joinTaskSession(sessionId, member.id);
  }

  const snapshot = await getTaskSessionSnapshot(sessionId);
  return (
    <HiveWorkspace
      currentMember={member}
      initialSnapshot={publicTaskSessionSnapshot(snapshot)}
      inviteToken={createSessionInviteToken(sessionId)}
      key={sessionId}
      sessionId={sessionId}
      sessionTitle={snapshot.session.title}
    />
  );
}
