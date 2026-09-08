import { type NextRequest, NextResponse } from "next/server";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import {
  hasGitHubInstallation,
  listTeamRepositories,
} from "@/lib/github-connection-store";
import { isTaskSessionId } from "@/lib/task-session-id";
import {
  applyTaskSessionAction,
  getPublicTaskSessionSnapshot,
  isTaskSessionMember,
} from "@/lib/task-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authenticatedRequest(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!isTaskSessionId(sessionId)) {
    return {
      response: NextResponse.json({ error: "Invalid session" }, { status: 400 }),
    };
  }

  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value,
  );
  if (!member) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!(await isTaskSessionMember(sessionId, member.id))) {
    return {
      response: NextResponse.json({ error: "Session not found" }, { status: 404 }),
    };
  }

  const githubUserId = Number(member.id.replace(/^github-/, ""));
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) {
    return {
      response: NextResponse.json(
        { error: "This Hive session is not linked to GitHub." },
        { status: 409 },
      ),
    };
  }

  return { githubUserId, member, sessionId };
}

function publicRepositories(
  repositories: Awaited<ReturnType<typeof listTeamRepositories>>,
) {
  return repositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    visibility: repository.visibility,
  }));
}

export async function GET(request: NextRequest) {
  const auth = await authenticatedRequest(request);
  if ("response" in auth) return auth.response;

  try {
    if (!(await hasGitHubInstallation())) {
      return NextResponse.json(
        { needsInstallation: true, repositories: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const repositories = await listTeamRepositories();
    return NextResponse.json(
      { needsInstallation: false, repositories: publicRepositories(repositories) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GitHub repository list failed", error);
    return NextResponse.json(
      { error: "Hive could not load the team repositories." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatedRequest(request);
  if ("response" in auth) return auth.response;

  const payload: unknown = await request.json().catch(() => null);
  const repositoryId =
    payload &&
    typeof payload === "object" &&
    "repositoryId" in payload &&
    typeof payload.repositoryId === "number"
      ? payload.repositoryId
      : NaN;
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    return NextResponse.json({ error: "Invalid repository" }, { status: 400 });
  }

  try {
    const snapshot = await getPublicTaskSessionSnapshot(auth.sessionId);
    if (snapshot.session.repository) {
      return NextResponse.json(
        { error: "This task already has a repository." },
        { status: 409 },
      );
    }

    const repositories = await listTeamRepositories();
    const repository = repositories.find(
      (candidate) => candidate.id === repositoryId,
    );
    if (!repository) {
      return NextResponse.json(
        { error: "That repository is not authorized for this team." },
        { status: 403 },
      );
    }

    await applyTaskSessionAction(
      auth.sessionId,
      {
        type: "connect-repository",
        actor: auth.member.id,
        repositoryUrl: repository.cloneUrl,
        repositoryName: repository.name,
        repositoryId: repository.id,
        repositoryBranch: repository.defaultBranch,
        installationId: repository.installationId,
        visibility: repository.visibility,
        githubUserId: auth.githubUserId,
        githubLogin: auth.member.githubLogin ?? auth.member.shortName,
      },
      auth.member,
    );

    return NextResponse.json(
      { repository: publicRepositories([repository])[0] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GitHub repository attachment failed", error);
    return NextResponse.json(
      { error: "Hive could not attach that repository." },
      { status: 502 },
    );
  }
}
