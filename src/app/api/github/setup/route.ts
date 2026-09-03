import { NextResponse } from "next/server";

import { getInstallationRepositories } from "@/lib/github-app";
import { verifyGitHubInstallState } from "@/lib/github-oauth";
import { isRoomId } from "@/lib/room-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function installationIdFrom(request: Request) {
  const value = new URL(request.url).searchParams.get("installation_id");
  if (!value || !/^\d+$/.test(value)) return null;
  const installationId = Number(value);
  return Number.isSafeInteger(installationId) && installationId > 0
    ? installationId
    : null;
}

export async function GET(request: Request) {
  const installationId = installationIdFrom(request);
  const state = new URL(request.url).searchParams.get("state");
  const roomId = verifyGitHubInstallState(state);
  if (!installationId || !isRoomId(roomId)) {
    return NextResponse.json(
      { error: "GitHub did not provide a valid installation ID." },
      { status: 400 },
    );
  }

  try {
    const repositories = await getInstallationRepositories(installationId);
    if (repositories.length !== 1) {
      return NextResponse.json(
        {
          error:
            "Hive's single-team demo expects exactly one selected repository. Update the GitHub App installation and try again.",
        },
        { status: 409 },
      );
    }

    return NextResponse.redirect(
      new URL(
        `/api/github/login?installation_id=${installationId}&return_to=${encodeURIComponent(`/rooms/${roomId}`)}`,
        request.url,
      ),
    );
  } catch (error) {
    console.error("GitHub App setup failed", error);
    return NextResponse.json(
      {
        error:
          "Hive could not verify this GitHub App installation. Check the installation and server credentials.",
      },
      { status: 502 },
    );
  }
}
