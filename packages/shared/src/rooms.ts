import { z } from "zod";

import { IdentifierSchema, RoomIdSchema } from "./realtime.js";

export const ClosedRoomsQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const ArchiveRoomInputSchema = z.object({ operationId: IdentifierSchema }).strict();

export const RoomArchiveResultSchema = z.object({
  alreadyArchived: z.boolean(),
  archivedAt: z.iso.datetime({ offset: true }),
  operationId: IdentifierSchema,
  roomId: RoomIdSchema,
}).strict();

const RankingPointsSchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const RankingPercentageSchema = z.number().min(0).max(100);

export const TableRankingPlayerSchema = z.object({
  handsPlayed: z.number().int().min(0),
  netResult: RankingPointsSchema,
  nickname: z.string().min(1).max(40),
  seatIndex: z.number().int().min(0).max(8).nullable(),
  seated: z.boolean(),
  totalBuyIn: RankingPointsSchema.min(0),
  userId: z.string().min(1).max(64),
  voluntarilyEnteredHands: z.number().int().min(0),
  vpip: RankingPercentageSchema,
  winningHands: z.number().int().min(0),
  winRate: RankingPercentageSchema,
}).strict();

export const TableRankingSchema = z.object({
  players: z.array(TableRankingPlayerSchema).max(100),
  roomId: RoomIdSchema,
  summary: z.object({
    activePlayers: z.number().int().min(0).max(9),
    averagePot: RankingPointsSchema.min(0),
    departedPlayers: z.number().int().min(0),
    elapsedSeconds: z.number().int().min(0),
    handsPlayed: z.number().int().min(0),
    totalBuyIn: RankingPointsSchema.min(0),
    totalPot: RankingPointsSchema.min(0),
  }).strict(),
}).strict();

export type ClosedRoomsQuery = z.infer<typeof ClosedRoomsQuerySchema>;
export type ArchiveRoomInput = z.infer<typeof ArchiveRoomInputSchema>;
export type RoomArchiveResult = z.infer<typeof RoomArchiveResultSchema>;
export type TableRanking = z.infer<typeof TableRankingSchema>;
export type TableRankingPlayer = z.infer<typeof TableRankingPlayerSchema>;
