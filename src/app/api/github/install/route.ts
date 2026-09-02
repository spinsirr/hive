import { NextResponse } from "next/server";

import { githubAppInstallUrl } from "@/lib/github-app";

export function GET() {
  return NextResponse.redirect(githubAppInstallUrl());
}
