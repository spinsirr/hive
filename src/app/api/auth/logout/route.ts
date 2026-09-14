import { type NextRequest, NextResponse } from "next/server";

import {
  deleteUserSession,
  HIVE_SESSION_COOKIE,
  sessionCookieOptions,
} from "@/server/auth/auth-session";
import {
  GITHUB_USER_COOKIE,
  githubUserCookieOptions,
} from "@/server/auth/github-user-session";

export async function POST(request: NextRequest) {
  await deleteUserSession(request.cookies.get(HIVE_SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    GITHUB_USER_COOKIE,
    "",
    githubUserCookieOptions(request.nextUrl.protocol === "https:", 0)
  );
  response.cookies.set(HIVE_SESSION_COOKIE, "", {
    ...sessionCookieOptions(request.nextUrl.protocol === "https:"),
    maxAge: 0,
  });
  return response;
}
