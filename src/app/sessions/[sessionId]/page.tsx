import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { HiveSignIn } from "@/components/hive/tasks/hive-sign-in";
import { HiveWorkspace } from "@/components/hive/hive-workspace";
import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import { publicTaskSessionSnapshot } from "@/lib/session/task-session-snapshot";
import {
  getPublicTaskSessionSnapshot,
  isTaskSessionMember,
  joinTaskSession,
  taskSessionExists,
} from "@/server/sessions/task-session-store";
import {
  createSessionInviteToken,
  verifySessionInviteToken,
} from "@/server/sessions/session-invite";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const { sessionId } = await params;
  const { invite: inviteParam } = await searchParams;
  const invite = typeof inviteParam === "string" ? inviteParam : undefined;
  if (!isTaskSessionId(sessionId) || !(await taskSessionExists(sessionId)))
    notFound();

  const cookieStore = await cookies();
  const member = await getSessionMember(
    cookieStore.get(HIVE_SESSION_COOKIE)?.value
  );

  const cleanReturnTo = `/sessions/${sessionId}`;
  const returnTo = invite
    ? `${cleanReturnTo}?invite=${encodeURIComponent(invite)}`
    : cleanReturnTo;
  if (!member) {
    return (
      <HiveSignIn
        description="Sign in with GitHub to join this task using your invitation. You’ll share its conversation and attached workspace, not anyone’s other tasks or repositories."
        returnTo={returnTo}
        title="Join this task"
      />
    );
  }

  if (!(await isTaskSessionMember(sessionId, member.id))) {
    if (!verifySessionInviteToken(sessionId, invite)) notFound();
    await joinTaskSession(sessionId, member.id);
  }

  const snapshot = await getPublicTaskSessionSnapshot(sessionId);
  return (
    <HiveWorkspace
      currentMember={member}
      initialSnapshot={publicTaskSessionSnapshot(snapshot)}
      inviteToken={createSessionInviteToken(sessionId)}
      key={sessionId}
      sessionId={sessionId}
    />
  );
}
