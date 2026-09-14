import { type NextRequest, NextResponse } from "next/server";

import {
  getSessionMember,
  HIVE_SESSION_COOKIE,
} from "@/server/auth/auth-session";
import {
  GitHubUserAuthorizationError,
  listGitHubUserRepositories,
} from "@/server/auth/github-oauth";
import {
  GITHUB_USER_COOKIE,
  readGitHubUserToken,
} from "@/server/auth/github-user-session";
import { isTaskSessionId } from "@/lib/tasks/task-session-id";
import { ARCHIVED_TASK_MESSAGE } from "@/lib/session/task-session";
import { WorkspaceRestoreError } from "@/lib/workspace/workspace-restore-state";
import {
  applyTaskSessionAction,
  getPublicTaskSessionSnapshot,
  isTaskSessionMember,
  TaskSessionAccessError,
} from "@/server/sessions/task-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authenticatedRequest(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!isTaskSessionId(sessionId)) {
    return {
      response: NextResponse.json(
        { error: "Invalid session" },
        { status: 400 }
      ),
    };
  }

  const member = await getSessionMember(
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  if (!member) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!(await isTaskSessionMember(sessionId, member.id))) {
    return {
      response: NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      ),
    };
  }

  const githubUserId = Number(member.id.replace(/^github-/, ""));
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) {
    return {
      response: NextResponse.json(
        { error: "This Hive session is not linked to GitHub." },
        { status: 409 }
      ),
    };
  }

  const accessToken = await readGitHubUserToken(
    request.cookies.get(GITHUB_USER_COOKIE)?.value,
    request.cookies.get(HIVE_SESSION_COOKIE)?.value
  );
  return { accessToken, githubUserId, member, sessionId };
}

function publicRepositories(
  repositories: Awaited<ReturnType<typeof listGitHubUserRepositories>>
) {
  return repositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    visibility: repository.visibility,
  }));
}

function reconnectResponse() {
  return NextResponse.json(
    {
      needsAuthorization: true,
      repositories: [],
      error: "Reconnect GitHub to choose a repository.",
    },
    {
      status: 409,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

export async function GET(request: NextRequest) {
  const auth = await authenticatedRequest(request);
  if ("response" in auth) return auth.response;
  if (!auth.accessToken) return reconnectResponse();

  try {
    const repositories = await listGitHubUserRepositories(auth.accessToken);
    return NextResponse.json(
      {
        needsInstallation: repositories.length === 0,
        repositories: publicRepositories(repositories),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof GitHubUserAuthorizationError)
      return reconnectResponse();
    console.error("GitHub repository list failed", error);
    return NextResponse.json(
      { error: "Hive could not load your GitHub repositories." },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const auth = await authenticatedRequest(request);
  if ("response" in auth) return auth.response;
  if (!auth.accessToken) return reconnectResponse();

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
    if (snapshot.session.archived)
      return NextResponse.json(
        { error: ARCHIVED_TASK_MESSAGE },
        { status: 409 }
      );
    if (snapshot.session.repository) {
      return NextResponse.json(
        { error: "This task already has a repository." },
        { status: 409 }
      );
    }

    const repositories = await listGitHubUserRepositories(auth.accessToken);
    const repository = repositories.find(
      (candidate) => candidate.id === repositoryId
    );
    if (!repository) {
      return NextResponse.json(
        { error: "That repository is not authorized for your GitHub account." },
        { status: 403 }
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
      auth.member
    );

    return NextResponse.json(
      { repository: publicRepositories([repository])[0] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof GitHubUserAuthorizationError)
      return reconnectResponse();
    if (error instanceof TaskSessionAccessError)
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers: { "Cache-Control": "private, no-store" } }
      );
    if (error instanceof WorkspaceRestoreError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    console.error("GitHub repository attachment failed", error);
    return NextResponse.json(
      { error: "Hive could not attach that repository." },
      { status: 502 }
    );
  }
}
