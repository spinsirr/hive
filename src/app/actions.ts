"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { createTaskSession as createStoredTaskSession } from "@/lib/task-session-store";

export async function createTaskSession(formData: FormData) {
  const cookieStore = await cookies();
  const member = await getSessionMember(
    cookieStore.get(HIVE_SESSION_COOKIE)?.value,
  );
  if (!member) throw new Error("Unauthorized");

  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 120) {
    throw new Error("Use a task title between 1 and 120 characters.");
  }

  const session = await createStoredTaskSession(title, member);
  redirect(`/sessions/${session.sessionId}`);
}
