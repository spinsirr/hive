import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { roomPresence, rooms, users } from "@/db/schema";
import {
  applyHiveRunError,
  applyHiveRunResult,
  appendHiveReply as appendHiveReplyToRoom,
  createInitialRoomState,
  type HiveRunResult,
  type HiveSessionCheckpoint,
  isMemberId,
  type MemberId,
  reduceRoom,
  resolveMember,
  type RoomAction,
  type RoomState,
  type TeamMember,
} from "@/lib/room";

export type RoomSnapshot = {
  room: RoomState;
  activeMembers: MemberId[];
  members: TeamMember[];
  typingMembers: MemberId[];
};

const ACTIVE_WINDOW_MS = 12_000;
const readyRooms = new Set<string>();

function roomValues(room: RoomState) {
  return {
    id: room.roomId,
    version: room.version,
    revision: room.revision,
    stage: room.stage,
    messages: room.messages,
    annotation: room.annotation,
    steeringQueue: room.steeringQueue,
    activeSteer: room.activeSteer ?? null,
    repository: room.repository ?? null,
    workspace: room.workspace,
    updatedAt: new Date(room.updatedAt),
  };
}

function roomState(row: typeof rooms.$inferSelect): RoomState {
  return {
    roomId: row.id,
    version: row.version,
    revision: row.revision === 2 ? 2 : 1,
    stage: row.stage,
    messages: row.messages,
    annotation: row.annotation,
    steeringQueue: row.steeringQueue,
    activeSteer: row.activeSteer ?? undefined,
    repository: row.repository ?? undefined,
    workspace: row.workspace,
    updatedAt: row.updatedAt.getTime(),
  };
}

async function ensureRoom(roomId: string, now: number) {
  if (readyRooms.has(roomId)) return;
  const initialRoom = createInitialRoomState(now, roomId);
  await db.insert(rooms).values(roomValues(initialRoom)).onConflictDoNothing();
  readyRooms.add(roomId);
}

async function getRoomMembers(roomId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      memberId: roomPresence.memberId,
      avatarUrl: users.avatarUrl,
      githubLogin: users.githubLogin,
      initials: users.initials,
      name: users.name,
      shortName: users.shortName,
    })
    .from(roomPresence)
    .leftJoin(users, eq(roomPresence.memberId, users.id))
    .where(eq(roomPresence.roomId, roomId));

  return rows.map((row) =>
    row.name && row.shortName && row.initials
      ? {
          id: row.memberId,
          name: row.name,
          shortName: row.shortName,
          initials: row.initials,
          githubLogin: row.githubLogin ?? undefined,
          avatarUrl: row.avatarUrl ?? undefined,
        }
      : resolveMember(row.memberId),
  );
}

export async function heartbeat(
  roomId: string,
  memberId: MemberId,
  typing = false,
  now = Date.now(),
) {
  await ensureRoom(roomId, now);
  await db
    .insert(roomPresence)
    .values({ roomId, memberId, lastSeen: new Date(now), typing })
    .onConflictDoUpdate({
      target: [roomPresence.roomId, roomPresence.memberId],
      set: { lastSeen: new Date(now), typing },
    });

  return getRoomSnapshot(roomId, now);
}

export async function applyRoomAction(
  roomId: string,
  action: RoomAction,
  actor?: TeamMember,
  now = Date.now(),
) {
  const storedMembers = await getRoomMembers(roomId);
  const members = actor
    ? [actor, ...storedMembers.filter((member) => member.id !== actor.id)]
    : storedMembers;

  await db.transaction(async (transaction) => {
    const initialRoom = createInitialRoomState(now, roomId);
    await transaction.insert(rooms).values(roomValues(initialRoom)).onConflictDoNothing();

    const [storedRoom] = await transaction
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");

    if (!storedRoom) {
      throw new Error(`Room ${roomId} could not be created.`);
    }

    const nextRoom = reduceRoom(roomState(storedRoom), action, now, members);
    await transaction
      .update(rooms)
      .set(roomValues(nextRoom))
      .where(eq(rooms.id, roomId));

    await transaction
      .insert(roomPresence)
      .values({
        roomId,
        memberId: action.actor,
        lastSeen: new Date(now),
        typing: false,
      })
      .onConflictDoUpdate({
        target: [roomPresence.roomId, roomPresence.memberId],
        set: { lastSeen: new Date(now) },
      });
  });
  readyRooms.add(roomId);

  return getRoomSnapshot(roomId, now);
}

export async function appendHiveReply(
  roomId: string,
  body: string,
  options: {
    forMessageId?: string;
    forMessageAnnotation?: {
      messageId: string;
      annotationId: string;
      steeredAt: number;
    };
    forActiveSteerAt?: number;
    forSteerAt?: number;
    status?: "error";
    runResult?: HiveRunResult;
    runError?: string;
    runCheckpoint?: HiveSessionCheckpoint;
  } = {},
  now = Date.now(),
) {
  await db.transaction(async (transaction) => {
    const [storedRoom] = await transaction
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");

    if (!storedRoom) {
      throw new Error(`Room ${roomId} could not be loaded.`);
    }

    const currentRoom = roomState(storedRoom);
    if (
      options.forMessageId &&
      !currentRoom.messages.some((message) => message.id === options.forMessageId)
    ) {
      return;
    }
    if (
      options.forSteerAt &&
      currentRoom.annotation.steeredAt !== options.forSteerAt
    ) {
      return;
    }
    if (options.forMessageAnnotation) {
      const { annotationId, messageId, steeredAt } =
        options.forMessageAnnotation;
      const annotation = currentRoom.messages
        .find((message) => message.id === messageId)
        ?.annotations?.find((item) => item.id === annotationId);
      if (annotation?.steeredAt !== steeredAt) return;
    }
    if (
      options.forActiveSteerAt &&
      currentRoom.activeSteer?.appliedAt !== options.forActiveSteerAt
    ) {
      return;
    }

    const repliedRoom = options.runResult
      ? applyHiveRunResult(currentRoom, options.runResult, now)
      : options.runError
        ? applyHiveRunError(
            currentRoom,
            options.runError,
            now,
            options.runCheckpoint,
          )
        : appendHiveReplyToRoom(currentRoom, body, now, options.status);
    const nextRoom =
      options.forActiveSteerAt && !options.runResult && !options.runError
        ? { ...repliedRoom, activeSteer: undefined }
        : repliedRoom;
    await transaction
      .update(rooms)
      .set(roomValues(nextRoom))
      .where(eq(rooms.id, roomId));
  });
  readyRooms.add(roomId);

  return getRoomSnapshot(roomId, now);
}

export async function getRoomSnapshot(
  roomId: string,
  now = Date.now(),
): Promise<RoomSnapshot> {
  let storedRoom = await db.query.rooms.findFirst({ where: eq(rooms.id, roomId) });

  if (!storedRoom) {
    readyRooms.delete(roomId);
    await ensureRoom(roomId, now);
    storedRoom = await db.query.rooms.findFirst({ where: eq(rooms.id, roomId) });
  } else {
    readyRooms.add(roomId);
  }

  if (!storedRoom) {
    throw new Error(`Room ${roomId} could not be loaded.`);
  }

  const activePresence = await db
    .select()
    .from(roomPresence)
    .where(
      and(
        eq(roomPresence.roomId, roomId),
        gte(roomPresence.lastSeen, new Date(now - ACTIVE_WINDOW_MS)),
      ),
    );

  const members = await getRoomMembers(roomId);
  const memberName = (memberId: MemberId) =>
    resolveMember(memberId, members).name;
  const activeMembers = activePresence
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberName(left).localeCompare(memberName(right)));
  const typingMembers = activePresence
    .filter(({ typing }) => typing)
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberName(left).localeCompare(memberName(right)));

  return {
    room: roomState(storedRoom),
    activeMembers,
    members,
    typingMembers,
  };
}
