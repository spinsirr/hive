import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { roomPresence, rooms } from "@/db/schema";
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
  type RoomAction,
  type RoomState,
} from "@/lib/room";

export type RoomSnapshot = {
  room: RoomState;
  activeMembers: MemberId[];
  typingMembers: MemberId[];
};

const ROOM_ID = "orbit-nav" as const;
const ACTIVE_WINDOW_MS = 12_000;
const memberOrder: MemberId[] = ["maya", "spencer"];
let roomReady = false;

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
    roomId: ROOM_ID,
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

async function ensureRoom(now: number) {
  if (roomReady) return;
  const initialRoom = createInitialRoomState(now);
  await db.insert(rooms).values(roomValues(initialRoom)).onConflictDoNothing();
  roomReady = true;
}

export async function heartbeat(
  memberId: MemberId,
  typing = false,
  now = Date.now(),
) {
  await ensureRoom(now);
  await db
    .insert(roomPresence)
    .values({ roomId: ROOM_ID, memberId, lastSeen: new Date(now), typing })
    .onConflictDoUpdate({
      target: [roomPresence.roomId, roomPresence.memberId],
      set: { lastSeen: new Date(now), typing },
    });

  return getRoomSnapshot(now);
}

export async function applyRoomAction(action: RoomAction, now = Date.now()) {
  await db.transaction(async (transaction) => {
    const initialRoom = createInitialRoomState(now);
    await transaction.insert(rooms).values(roomValues(initialRoom)).onConflictDoNothing();

    const [storedRoom] = await transaction
      .select()
      .from(rooms)
      .where(eq(rooms.id, ROOM_ID))
      .for("update");

    if (!storedRoom) {
      throw new Error(`Room ${ROOM_ID} could not be created.`);
    }

    const nextRoom = reduceRoom(roomState(storedRoom), action, now);
    await transaction
      .update(rooms)
      .set(roomValues(nextRoom))
      .where(eq(rooms.id, ROOM_ID));

    await transaction
      .insert(roomPresence)
      .values({
        roomId: ROOM_ID,
        memberId: action.actor,
        lastSeen: new Date(now),
        typing: false,
      })
      .onConflictDoUpdate({
        target: [roomPresence.roomId, roomPresence.memberId],
        set: { lastSeen: new Date(now) },
      });
  });
  roomReady = true;

  return getRoomSnapshot(now);
}

export async function appendHiveReply(
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
      .where(eq(rooms.id, ROOM_ID))
      .for("update");

    if (!storedRoom) {
      throw new Error(`Room ${ROOM_ID} could not be loaded.`);
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
      .where(eq(rooms.id, ROOM_ID));
  });
  roomReady = true;

  return getRoomSnapshot(now);
}

export async function getRoomSnapshot(now = Date.now()): Promise<RoomSnapshot> {
  let storedRoom = await db.query.rooms.findFirst({ where: eq(rooms.id, ROOM_ID) });

  if (!storedRoom) {
    roomReady = false;
    await ensureRoom(now);
    storedRoom = await db.query.rooms.findFirst({ where: eq(rooms.id, ROOM_ID) });
  } else {
    roomReady = true;
  }

  if (!storedRoom) {
    throw new Error(`Room ${ROOM_ID} could not be loaded.`);
  }

  const activePresence = await db
    .select()
    .from(roomPresence)
    .where(
      and(
        eq(roomPresence.roomId, ROOM_ID),
        gte(roomPresence.lastSeen, new Date(now - ACTIVE_WINDOW_MS)),
      ),
    );

  const activeMembers = activePresence
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberOrder.indexOf(left) - memberOrder.indexOf(right));
  const typingMembers = activePresence
    .filter(({ typing }) => typing)
    .map(({ memberId }) => memberId)
    .filter(isMemberId)
    .sort((left, right) => memberOrder.indexOf(left) - memberOrder.indexOf(right));

  return {
    room: roomState(storedRoom),
    activeMembers,
    typingMembers,
  };
}
