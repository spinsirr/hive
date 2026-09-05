import { ArrowRight, CheckCircle2, Circle, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";

import { createTaskSession } from "@/app/actions";
import { CreateSessionButton } from "@/components/hive/create-session-button";
import { HiveSignIn } from "@/components/hive/hive-sign-in";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { listTaskSessions } from "@/lib/task-session-store";

export const dynamic = "force-dynamic";

function HiveMark() {
  return (
    <span className="grid size-8 place-items-center rounded-md bg-[#171717] text-white">
      <svg aria-hidden="true" className="size-[68%]" fill="none" viewBox="0 0 24 24">
        <path d="M12 3.5 15 5.25v3.5l-3 1.75-3-1.75v-3.5L12 3.5ZM8 11l3 1.75v3.5L8 18l-3-1.75v-3.5L8 11Zm8 0 3 1.75v3.5L16 18l-3-1.75v-3.5L16 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
      </svg>
    </span>
  );
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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

  const sessions = await listTaskSessions(member.id);
  const active = sessions.filter((session) => session.lifecycle === "active");
  const completed = sessions.filter(
    (session) => session.lifecycle === "completed",
  );

  return (
    <main className="min-h-dvh bg-[#fafafa] text-[#171717]">
      <header className="flex h-14 items-center justify-between border-b border-[#e8e8e8] bg-white px-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <HiveMark />
          <span className="text-sm font-semibold tracking-[-0.03em]">Hive</span>
        </div>
        <span className="text-xs text-[#737373]">{member.name}</span>
      </header>

      <div className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-6xl gap-12 px-6 py-12 lg:grid-cols-[minmax(280px,0.72fr)_minmax(460px,1.28fr)] lg:px-10 lg:py-20">
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8a8a]">Multiplayer coding agent</p>
          <h1 className="mt-5 max-w-md text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl">
            Your team.<br />One coding agent.<br />Build together.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-6 text-[#737373]">
            Invite your teammates into one shared agent session. Discuss ideas, annotate messages, and steer the work together—from the first prompt to the final diff.
          </p>

          <form action={createTaskSession} className="mt-10 flex max-w-md gap-2 rounded-lg border border-[#dcdcdc] bg-white p-2 shadow-[0_12px_40px_rgba(0,0,0,0.05)]">
            <input
              autoComplete="off"
              autoFocus
              className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-[#a1a1a1]"
              maxLength={120}
              name="title"
              placeholder="What should we build together?"
              required
            />
            <CreateSessionButton />
          </form>
        </section>

        <section className="self-start overflow-hidden rounded-xl border border-[#dedede] bg-white shadow-[0_16px_50px_rgba(0,0,0,0.045)]">
          <div className="flex items-center justify-between border-b border-[#ebebeb] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-[-0.02em]">Shared tasks</h2>
            <span className="font-mono text-[10px] text-[#999]">{active.length} active</span>
          </div>

          {sessions.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-8 text-center">
              <div>
                <Circle className="mx-auto size-5 text-[#999]" />
                <p className="mt-4 text-sm font-medium">No tasks yet</p>
                <p className="mt-1 text-xs text-[#888]">Name the outcome on the left to begin.</p>
              </div>
            </div>
          ) : (
            <div>
              {[...active, ...completed].map((session) => (
                <Link
                  className="group flex items-center gap-4 border-b border-[#eeeeee] px-5 py-4 transition last:border-b-0 hover:bg-[#fafafa]"
                  href={`/sessions/${session.id}`}
                  key={session.id}
                >
                  {session.lifecycle === "completed" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-[#888]" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-[#171717]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium tracking-[-0.015em]">{session.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#8a8a8a]">
                      {session.repository ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <FolderGit2 className="size-3" />
                          <span className="truncate">{session.repository.name}</span>
                        </span>
                      ) : (
                        <span>No repository</span>
                      )}
                      <span>·</span>
                      <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-[#aaa] transition group-hover:translate-x-0.5 group-hover:text-[#171717]" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
