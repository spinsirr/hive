import { cookies } from "next/headers";

import { HiveSignIn } from "@/components/hive/hive-sign-in";
import { TaskDashboard } from "@/components/hive/task-dashboard";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string | string[] }>;
}) {
  const { signin } = await searchParams;
  const cookieStore = await cookies();
  const member =
    signin === "retry"
      ? null
      : await getSessionMember(cookieStore.get(HIVE_SESSION_COOKIE)?.value);
  if (!member || signin === "retry") {
    const retry = signin === "retry";
    return (
      <HiveSignIn
        description={
          retry
            ? "This sign-in expired or could not be verified. Try again from Hive. Joining a team? Reopen your invitation link."
            : "Sign in with GitHub to create your first task. Invite teammates to steer the same coding agent together. Your tasks stay private until you invite someone."
        }
        returnTo="/"
        title={
          retry ? "Let’s try signing in again" : "Build together with Hive"
        }
      />
    );
  }

  // Keep the existing membership-scoped query. The client only needs list
  // metadata, not repository authorization details or a full task transcript.
  // Visitors can reach the public demo without loading the task database.
  const [{ listTaskSessions }, { createTaskSession }] = await Promise.all([
    import("@/lib/task-session-store"),
    import("@/app/actions"),
  ]);
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
        repositoryName: session.repository?.name ?? null,
        updatedAt: session.updatedAt,
        archivedAt: session.archived?.at ?? null,
      }))}
    />
  );
}
