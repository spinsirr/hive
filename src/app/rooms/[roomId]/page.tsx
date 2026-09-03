import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { HiveSignIn } from "@/components/hive/hive-sign-in";
import { HiveWorkspace } from "@/components/hive/hive-workspace";
import { getSessionMember, HIVE_SESSION_COOKIE } from "@/lib/auth-session";
import { isRoomId } from "@/lib/room-id";

export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!isRoomId(roomId)) notFound();

  const cookieStore = await cookies();
  const member = await getSessionMember(
    cookieStore.get(HIVE_SESSION_COOKIE)?.value,
  );

  if (!member) return <HiveSignIn roomId={roomId} />;
  return <HiveWorkspace currentMember={member} roomId={roomId} />;
}
