import { type NextRequest, NextResponse } from "next/server";

import { githubAppInstallUrl } from "@/lib/github-app";
import { createGitHubInstallState } from "@/lib/github-oauth";
import { isRoomId } from "@/lib/room-id";

export function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!isRoomId(roomId)) {
    return NextResponse.json({ error: "Invalid room" }, { status: 400 });
  }
  return NextResponse.redirect(
    githubAppInstallUrl(createGitHubInstallState(roomId)),
  );
}
