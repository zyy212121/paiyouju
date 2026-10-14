import { createHash } from "node:crypto";
import { RoomArchiveResultSchema, TableRankingSchema, tableDiamondFees, type ArchiveRoomInput, type ClosedRoomsQuery, type RoomArchiveResult } from "@paiyouju/shared";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { hashPassword, verifyPassword } from "../../security/passwords.js";
import { createRoomCode } from "./room-code.js";
import type { CreateRoomInput, JoinRoomInput } from "./room.schemas.js";
import type { RoomLifecycleMutation } from "../../app.js";
import { effectiveBuyInTotalsByUser } from "../tables/session-buy-in-totals.js";

interface RoomServiceOptions {
  readonly clock?: () => Date;
  readonly maxCodeAttempts?: number;
  readonly onRoomChanged?: (roomId: string) => void | Promise<void>;
  readonly onRoomUpdating?: (
    roomId: string,
    action: "CLOSE" | "PAUSE" | "RESUME",
    room: RoomLifecycleMutation,
    transaction: Prisma.TransactionClient,
    administrator: boolean,
  ) => void | Promise<void>;
  readonly roomCode?: () => string;
  readonly runRoomMutation?: <T>(roomId: string, mutation: () => Promise<T>) => Promise<T>;
}

interface ClosedRoomCursor {
  readonly at: string;
  readonly id: string;
  readonly kind: "closed-room";
  readonly userId: string;
}

function encodeClosedRoomCursor(value: ClosedRoomCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeClosedRoomCursor(raw: string | undefined, userId: string): ClosedRoomCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.kind !== "closed-room" || value.userId !== userId || typeof value.at !== "string" || typeof value.id !== "string" || !Number.isFinite(Date.parse(value.at))) {
      throw new Error("invalid cursor");
    }
    return { at: new Date(value.at).toISOString(), id: value.id, kind: "closed-room", userId };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "分页游标无效");
  }
}

const roomInclude = {
  members: {
    orderBy: { joinedAt: "asc" },
    select: {
      joinedAt: true,
      role: true,
      user: { select: { id: true, nickname: true, username: true } },
    },
  },
  tableSeats: { select: { id: true } },
} satisfies Prisma.RoomInclude;

type RoomWithMembers = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function stableHash(input: unknown): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}

function safeRoom(room: RoomWithMembers) {
  return {
    actionTimeSeconds: room.actionTimeSeconds,
    archivedAt: room.archivedAt,
    bigBlind: room.bigBlind,
    bombPotBlindMultiplier: room.bombPotBlindMultiplier,
    bombPotIntervalMinutes: room.bombPotIntervalMinutes,
    bombPotNextAt: room.bombPotNextAt,
    closeRequestedAt: room.closeRequestedAt,
    closedAt: room.closedAt,
    createdAt: room.createdAt,
    durationMinutes: room.durationMinutes,
    expiresAt: room.expiresAt,
    id: room.id,
    initialBuyIn: room.initialBuyIn,
    maximumBuyIn: room.maximumBuyIn,
    maxSeats: room.maxSeats,
    members: room.members,
    minimumBuyIn: room.minimumBuyIn,
    name: room.name,
    nextHandPaused: room.nextHandPaused,
    ownerId: room.ownerId,
    paidCardRevealCost: room.paidCardRevealCost,
    paidCardRevealEnabled: room.paidCardRevealEnabled,
    requiresManualStart: room.requiresManualStart,
    runItTwiceEnabled: room.runItTwiceEnabled,
    roomCode: room.roomCode,
    smallBlind: room.smallBlind,
    specialMode: room.specialMode,
    status: room.status,
    squidRoundGraceEndsAt: room.squidRoundGraceEndsAt,
    squidRoundNumber: room.squidRoundNumber,
    squidSettlementPending: room.squidSettlementPending,
    squidStake: room.squidStake,
    tableStartedAt: room.tableStartedAt,
    updatedAt: room.updatedAt,
  };
}

function publicRoom(room: RoomWithMembers, userId: string) {
  const membership = room.members.find((member) => member.user.id === userId);
  if (!membership) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在");
  }
  return {
    ...safeRoom(room),
    hasPassword: room.passwordHash !== null,
    memberRole: membership.role,
  };
}

export function createRoomService(
  database: DatabaseClient,
  options: RoomServiceOptions = {},
) {
  const clock = options.clock ?? (() => new Date());
  const codeFactory = options.roomCode ?? createRoomCode;
  const maxCodeAttempts = options.maxCodeAttempts ?? 8;

  async function findIdempotentCreate(
    ownerId: string,
    key: string,
    requestHash: string,
  ) {
    const existing = await database.requestIdempotency.findUnique({
      where: { scope_actorId_key: { actorId: ownerId, key, scope: "ROOM_CREATE" } },
    });
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
    }
    if (!existing.resourceId) {
      throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "请求正在处理");
    }
    const room = await database.room.findUnique({ include: roomInclude, where: { id: existing.resourceId } });
    if (!room) {
      throw new ApiError(500, "INTERNAL_ERROR", "服务器内部错误");
    }
    return publicRoom(room, ownerId);
  }

  async function updateOwnedRoom(
    userId: string,
    roomId: string,
    action: "CLOSE" | "PAUSE" | "RESUME",
    administrator = false,
  ) {
    const mutation = () => database.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
      `;
      const membership = administrator
        ? null
        : await transaction.roomMember.findUnique({
            include: { room: { include: roomInclude } },
            where: { roomId_userId: { roomId, userId } },
          });
      const room = administrator
        ? await transaction.room.findUnique({ include: roomInclude, where: { id: roomId } })
        : membership?.room ?? null;
      if (!room) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在");
      }
      if (
        !administrator
        && (membership?.role !== "OWNER" || room.ownerId !== userId)
      ) {
        throw new ApiError(
          403,
          "ROOM_OWNER_REQUIRED",
          "仅房主可执行此操作",
        );
      }
      if (administrator && action === "CLOSE" && room.status !== "OPEN") {
        const snapshot = await transaction.tableSnapshot.findUnique({
          select: { recoveryStatus: true, runtimeStatus: true },
          where: { roomId },
        });
        if (snapshot?.recoveryStatus === "ERROR" && snapshot.runtimeStatus === "RECOVERY_ERROR") {
          await options.onRoomUpdating?.(roomId, action, room, transaction, true);
          const committedRoom = await transaction.room.findUniqueOrThrow({ include: roomInclude, where: { id: roomId } });
          return safeRoom(committedRoom);
        }
      }
      if (action === "CLOSE" && room.status === "CLOSED") {
        return administrator ? safeRoom(room) : publicRoom(room, userId);
      }
      if (room.status !== "OPEN") {
        if (action === "CLOSE" && room.status === "CLOSING") {
          return administrator ? safeRoom(room) : publicRoom(room, userId);
        }
        throw new ApiError(409, "ROOM_NOT_OPEN", "房间已关闭");
      }

      const data =
        action === "CLOSE"
          ? await (async () => {
              const now = new Date();
              const activeSessions = await transaction.gameSession.count({
                where: { roomId, status: "ACTIVE" },
              });
              const occupied = room.tableSeats.length > 0 || activeSessions > 0;
              return {
                closedAt: occupied ? null : now,
                closeRequestedAt: now,
                requiresManualStart: true,
                status: occupied ? "CLOSING" as const : "CLOSED" as const,
                tableStartedAt: null,
              };
            })()
          : { nextHandPaused: action === "PAUSE" };
      const updated = await transaction.room.update({
        data,
        include: roomInclude,
        where: { id: roomId },
      });
      await options.onRoomUpdating?.(roomId, action, updated, transaction, administrator);
      const committedRoom = await transaction.room.findUniqueOrThrow({ include: roomInclude, where: { id: roomId } });
      return administrator ? safeRoom(committedRoom) : publicRoom(committedRoom, userId);
    });
    const result = options.runRoomMutation
      ? await options.runRoomMutation(roomId, mutation)
      : await mutation();
    await options.onRoomChanged?.(roomId);
    return result;
  }

  return {
    async mutateRoomAsAdministrator(roomId: string, action: "CLOSE" | "PAUSE" | "RESUME") {
      return updateOwnedRoom("administrator", roomId, action, true);
    },

    async closeRoom(userId: string, roomId: string) {
      return updateOwnedRoom(userId, roomId, "CLOSE");
    },

    async archiveRoom(userId: string, roomId: string, input: ArchiveRoomInput): Promise<RoomArchiveResult> {
      const requestHash = stableHash({ roomId });
      const existing = await database.requestIdempotency.findUnique({
        where: { scope_actorId_key: { actorId: userId, key: input.operationId, scope: "ROOM_ARCHIVE" } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他归档请求");
        const parsed = RoomArchiveResultSchema.safeParse(existing.response);
        if (!parsed.success) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "归档请求正在处理");
        return parsed.data;
      }
      const result = await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
        `;
        const replay = await transaction.requestIdempotency.findUnique({
          where: { scope_actorId_key: { actorId: userId, key: input.operationId, scope: "ROOM_ARCHIVE" } },
        });
        if (replay) {
          if (replay.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他归档请求");
          const parsed = RoomArchiveResultSchema.safeParse(replay.response);
          if (!parsed.success) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "归档请求正在处理");
          return parsed.data;
        }
        const room = await transaction.room.findUnique({
          include: { _count: { select: { tableSeats: true } } },
          where: { id: roomId },
        });
        if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在");
        if (room.ownerId !== userId) throw new ApiError(403, "ROOM_OWNER_REQUIRED", "仅房主可归档房间");
        const activeSessions = await transaction.gameSession.count({ where: { roomId, status: "ACTIVE" } });
        if (
          room.status !== "CLOSED"
          || room._count.tableSeats !== 0
          || activeSessions !== 0
        ) throw new ApiError(409, "ROOM_ARCHIVE_NOT_SAFE", "房间尚未安全结束，不能归档");
        const archivedAt = room.archivedAt ?? new Date();
        if (!room.archivedAt) {
          await transaction.room.update({ data: { archivedAt, archivedByUserId: userId }, where: { id: roomId } });
        }
        const response = RoomArchiveResultSchema.parse({
          alreadyArchived: room.archivedAt !== null,
          archivedAt: archivedAt.toISOString(),
          operationId: input.operationId,
          roomId,
        });
        await transaction.requestIdempotency.create({
          data: { actorId: userId, key: input.operationId, requestHash, resourceId: roomId, response: response as unknown as Prisma.InputJsonValue, scope: "ROOM_ARCHIVE" },
        });
        return response;
      });
      await options.onRoomChanged?.(roomId);
      return result;
    },

    async createRoom(ownerId: string, input: CreateRoomInput, idempotencyKey: string) {
      const requestHash = stableHash(input);
      const existing = await findIdempotentCreate(ownerId, idempotencyKey, requestHash);
      if (existing) {
        return existing;
      }
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      const createdAt = clock();
      const expiresAt = new Date(createdAt.getTime() + input.durationMinutes * 60_000);
      const diamondFees = tableDiamondFees();

      for (let attempt = 0; attempt < maxCodeAttempts; attempt += 1) {
        const roomCode = codeFactory();
        try {
          const room = await database.$transaction(async (transaction) => {
            const created = await transaction.room.create({
              data: {
                actionTimeSeconds: input.actionTimeSeconds,
                bigBlind: input.bigBlind,
                bombPotBlindMultiplier: input.bombPotBlindMultiplier ?? null,
                bombPotIntervalMinutes: input.bombPotIntervalMinutes ?? null,
                createdAt,
                durationMinutes: input.durationMinutes,
                expiresAt,
                initialBuyIn: input.initialBuyIn,
                maximumBuyIn: input.maximumBuyIn,
                maxSeats: input.maxSeats,
                minimumBuyIn: input.minimumBuyIn,
                name: input.name,
                ownerId,
                paidCardRevealCost: diamondFees.paidHandReveal,
                paidCardRevealEnabled: true,
                passwordHash,
                roomCode,
                runItTwiceEnabled: input.specialMode === "NORMAL" && (input.runItTwiceEnabled ?? false),
                smallBlind: input.smallBlind,
                specialMode: input.specialMode,
                squidStake: input.squidStake,
              },
            });
            await transaction.roomMember.create({ data: { role: "OWNER", roomId: created.id, userId: ownerId } });
            await transaction.requestIdempotency.create({
              data: { actorId: ownerId, key: idempotencyKey, requestHash, resourceId: created.id, scope: "ROOM_CREATE" },
            });
            return transaction.room.findUniqueOrThrow({ include: roomInclude, where: { id: created.id } });
          });
          return publicRoom(room, ownerId);
        } catch (error: unknown) {
          if (isUniqueViolation(error)) {
            const replay = await findIdempotentCreate(ownerId, idempotencyKey, requestHash);
            if (replay) {
              return replay;
            }
            continue;
          }
          throw error;
        }
      }
      throw new ApiError(503, "ROOM_CODE_EXHAUSTED", "暂时无法分配房间码");
    },

    async getRoom(userId: string, roomId: string) {
      const room = await database.room.findFirst({
        include: roomInclude,
        where: { id: roomId, members: { some: { userId } } },
      });
      if (!room) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在");
      }
      return publicRoom(room, userId);
    },

    async getRankings(userId: string, roomId: string) {
      const room = await database.room.findFirst({
        select: {
          closedAt: true,
          createdAt: true,
          id: true,
          members: { select: { user: { select: { id: true, nickname: true } } } },
          tableSeats: { select: { seatIndex: true, userId: true } },
          tableStartedAt: true,
        },
        where: { id: roomId, members: { some: { userId } } },
      });
      if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在");

      const [sessions, handPlayers, handCount, potTotal] = await Promise.all([
        database.gameSession.findMany({
          orderBy: [{ userId: "asc" }, { startedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            roomId: true,
            startedAt: true,
            tableStackEntries: {
              orderBy: { sequence: "asc" },
              select: { sequence: true, signedAmount: true, type: true },
              take: 1,
            },
            totalBuyIn: true,
            userId: true,
          },
          where: { roomId },
        }),
        database.handPlayerRecord.findMany({
          select: {
            actions: { select: { actionType: true, street: true } },
            handId: true,
            netResult: true,
            userId: true,
          },
          where: { roomId },
        }),
        database.handRecord.count({ where: { roomId } }),
        database.handPotRecord.aggregate({ _sum: { amount: true }, where: { hand: { roomId } } }),
      ]);

      const nicknameByUser = new Map(room.members.map((member) => [member.user.id, member.user.nickname]));
      const seatByUser = new Map(room.tableSeats.map((seat) => [seat.userId, seat.seatIndex]));
      const buyInByUser = effectiveBuyInTotalsByUser(sessions);
      const handStats = new Map<string, { hands: number; net: number; voluntary: number; wins: number }>();
      for (const player of handPlayers) {
        const stats = handStats.get(player.userId) ?? { hands: 0, net: 0, voluntary: 0, wins: 0 };
        stats.hands += 1;
        stats.net += player.netResult;
        if (player.netResult > 0) stats.wins += 1;
        if (player.actions.some((action) => action.street === "PREFLOP" && ["ALL_IN", "BET", "CALL", "RAISE_TO"].includes(action.actionType))) stats.voluntary += 1;
        handStats.set(player.userId, stats);
      }
      const candidates = new Set([...buyInByUser.keys(), ...seatByUser.keys()]);
      const percentage = (part: number, total: number) => total === 0 ? 0 : Math.round((part / total) * 1_000) / 10;
      const players = [...candidates].map((candidateUserId) => {
        const stats = handStats.get(candidateUserId) ?? { hands: 0, net: 0, voluntary: 0, wins: 0 };
        const seatIndex = seatByUser.get(candidateUserId);
        return {
          handsPlayed: stats.hands,
          netResult: stats.net,
          nickname: nicknameByUser.get(candidateUserId) ?? "已离桌玩家",
          seatIndex: seatIndex ?? null,
          seated: seatIndex !== undefined,
          totalBuyIn: buyInByUser.get(candidateUserId) ?? 0,
          userId: candidateUserId,
          voluntarilyEnteredHands: stats.voluntary,
          vpip: percentage(stats.voluntary, stats.hands),
          winningHands: stats.wins,
          winRate: percentage(stats.wins, stats.hands),
        };
      }).sort((left, right) => right.netResult - left.netResult || left.nickname.localeCompare(right.nickname) || left.userId.localeCompare(right.userId));
      const totalPot = potTotal._sum.amount ?? 0;
      const startedAt = sessions.reduce<Date | null>((earliest, session) => !earliest || session.startedAt < earliest ? session.startedAt : earliest, room.tableStartedAt);
      const endedAt = room.closedAt ?? clock();

      return TableRankingSchema.parse({
        players,
        roomId,
        summary: {
          activePlayers: room.tableSeats.length,
          averagePot: handCount === 0 ? 0 : Math.round(totalPot / handCount),
          departedPlayers: players.filter((player) => !player.seated).length,
          elapsedSeconds: Math.max(0, Math.floor((endedAt.getTime() - (startedAt ?? room.createdAt).getTime()) / 1_000)),
          handsPlayed: handCount,
          totalBuyIn: [...buyInByUser.values()].reduce((sum, value) => sum + value, 0),
          totalPot,
        },
      });
    },

    async joinRoom(userId: string, input: JoinRoomInput) {
      const room = await database.room.findUnique({ include: roomInclude, where: { roomCode: input.roomCode } });
      if (room?.members.some((member) => member.user.id === userId)) {
        return publicRoom(room, userId);
      }
      const suppliedPasswordMatches = room?.passwordHash
        ? input.password
          ? await verifyPassword(room.passwordHash, input.password)
          : false
        : room !== null;
      if (!room || room.status !== "OPEN" || !suppliedPasswordMatches) {
        throw new ApiError(403, "ROOM_JOIN_DENIED", "无法加入房间");
      }
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${room.id} FOR UPDATE
        `;
        const lockedRoom = await transaction.room.findUnique({
          include: roomInclude,
          where: { id: room.id },
        });
        if (!lockedRoom || lockedRoom.status !== "OPEN") {
          throw new ApiError(403, "ROOM_JOIN_DENIED", "无法加入房间");
        }
        const existing = lockedRoom.members.some(
          (member) => member.user.id === userId,
        );
        if (existing) {
          return publicRoom(lockedRoom, userId);
        }
        try {
          await transaction.roomMember.create({
            data: { roomId: room.id, userId },
          });
        } catch (error: unknown) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
        const updated = await transaction.room.findUniqueOrThrow({
          include: roomInclude,
          where: { id: room.id },
        });
        return publicRoom(updated, userId);
      });
    },

    async listRooms(userId: string) {
      const rooms = await database.room.findMany({
        include: roomInclude,
        orderBy: { createdAt: "desc" },
        where: { archivedAt: null, members: { some: { userId } }, status: { in: ["OPEN", "CLOSING"] } },
      });
      return rooms.map((room) => publicRoom(room, userId));
    },

    async listClosedRooms(userId: string, query: ClosedRoomsQuery) {
      const cursor = decodeClosedRoomCursor(query.cursor, userId);
      const rooms = await database.room.findMany({
        include: roomInclude,
        orderBy: [{ closedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        where: {
          archivedAt: null,
          closedAt: { not: null },
          members: { some: { userId } },
          status: "CLOSED",
          ...(cursor ? { OR: [{ closedAt: { lt: new Date(cursor.at) } }, { closedAt: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
        },
      });
      const hasMore = rooms.length > query.limit;
      const page = rooms.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((room) => publicRoom(room, userId)),
        nextCursor: hasMore && last?.closedAt
          ? encodeClosedRoomCursor({ at: last.closedAt.toISOString(), id: last.id, kind: "closed-room", userId })
          : null,
      };
    },

    async pauseRoom(userId: string, roomId: string) {
      return updateOwnedRoom(userId, roomId, "PAUSE");
    },

    async resumeRoom(userId: string, roomId: string) {
      return updateOwnedRoom(userId, roomId, "RESUME");
    },
  };
}
