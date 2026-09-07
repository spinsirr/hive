import { cookies } from "next/headers";

import { createTaskSession } from "@/app/actions";
import { HiveSignIn } from "@/components/hive/hive-sign-in";
import { TaskDashboard } from "@/components/hive/task-dashboard";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { listTaskSessions } from "@/lib/task-session-store";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string | string[] }>;
}) {
  const { signin } = await searchParams;
  const cookieStore = await cookies();
  const member = await getSessionMember(
    cookieStore.get(HIVE_SESSION_COOKIE)?.value,
  );
  if (!member || signin === "retry") {
    const inviteRequired = signin === "invite-required";
    const retry = signin === "retry";
    return (
      <HiveSignIn
        description={retry
          ? "This sign-in expired or could not be verified. Try again from Hive. Joining a team? Reopen your invitation link."
          : inviteRequired
          ? "Ask a teammate for an Invite link, then open it to join. Already a member? Sign in with the GitHub account you joined with."
          : "Create a task, invite a teammate, and steer the same coding agent together. New members need an invitation."}
        returnTo="/"
        title={retry ? "Let’s try signing in again" : inviteRequired ? "You need a team invitation" : "Your team’s work with Hive"}
      />
    );
  }

  // Keep the existing membership-scoped query. The client only needs list
  // metadata, not repository authorization details or a full task transcript.
  const sessions = await listTaskSessions(member.id);
  // This dynamic Server Component captures one request time; the client only
  // renders that serialized value, including during hydration.
  // eslint-disable-next-line react-hooks/purity
  const loadedAt = Date.now();
  return (
    <TaskDashboard
      createAction={createTaskSession}
      loadedAt={loadedAt}
      memberInitials={member.initials}
      memberName={member.name}
      tasks={sessions.map((session) => ({
        id: session.id,
        title: session.title,
        lifecycle: session.lifecycle,
        repositoryName: session.repository?.name ?? null,
        updatedAt: session.updatedAt,
      }))}
    />
  );
}
