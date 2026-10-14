import {
  GameSessionDetailSchema,
  GameSessionSummarySchema,
  HandDetailSchema,
  HandReplaySchema,
  HandSummarySchema,
  HistoryEventSchema,
  HypotheticalRunoutResultSchema,
  type GameHistoryQuery,
  type GameSessionSummary,
  type HandDetailPlayer,
  type HandHistoryQuery,
  type HandSummary,
  type HistoryEvent,
} from "@paiyouju/shared";
import { HandCategory, evaluateBestFiveCards, parseCard } from "@paiyouju/poker-core";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { buildHandReplayTimeline, ReplayNotAvailableError } from "./replay-builder.js";
import {
  displayHandNumber,
  projectRunoutPlayerAmounts,
  runoutIndices,
  splitForRunout,
  type HistoryRunoutIndex,
} from "./runout-history.js";

interface CursorValue {
  readonly at: string;
  readonly id: string;
  readonly kind: "game" | "hand";
  readonly ownerId: string;
  readonly scope: string;
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined, kind: CursorValue["kind"], ownerId: string, scope: string): CursorValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      parsed.kind !== kind
      || parsed.ownerId !== ownerId
      || parsed.scope !== scope
      || typeof parsed.at !== "string"
      || typeof parsed.id !== "string"
      || !Number.isFinite(Date.parse(parsed.at))
    ) throw new Error("shape");
    return { at: new Date(parsed.at).toISOString(), id: parsed.id, kind, ownerId, scope };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "分页游标无效");
  }
}

function gameCursorScope(query: GameHistoryQuery): string {
  return JSON.stringify({ roomId: query.roomId ?? null, status: query.status ?? null });
}

function handCursorScope(query: HandHistoryQuery): string {
  return JSON.stringify({
    finishedFrom: query.finishedFrom ?? null,
    finishedTo: query.finishedTo ?? null,
    result: query.result ?? null,
    roomId: query.roomId ?? null,
  });
}

function assertCards(cards: readonly string[]): [string, string] {
  if (cards.length !== 2) throw new ApiError(500, "PERSISTENCE_ERROR", "历史底牌记录不完整");
  return [cards[0]!, cards[1]!];
}

const HAND_CATEGORY_LABELS: Readonly<Record<HandCategory, string>> = {
  [HandCategory.HighCard]: "高牌",
  [HandCategory.OnePair]: "一对",
  [HandCategory.TwoPair]: "两对",
  [HandCategory.ThreeOfAKind]: "三条",
  [HandCategory.Straight]: "顺子",
  [HandCategory.Flush]: "同花",
  [HandCategory.FullHouse]: "葫芦",
  [HandCategory.FourOfAKind]: "四条",
  [HandCategory.StraightFlush]: "同花顺",
};

function isPublicShowdown(player: { readonly holeCardsPublic: boolean; readonly holeCardsPublicReason?: string | null }): boolean {
  return player.holeCardsPublic && player.holeCardsPublicReason !== "VOLUNTARY";
}

function historicalHandLabel(
  holeCards: readonly string[],
  board: readonly string[],
  variant: "STANDARD" | "SHORT_DECK",
): string | null {
  if (holeCards.length !== 2) return null;
  if (board.length === 0) return parseCard(holeCards[0]!).rank === parseCard(holeCards[1]!).rank ? "一对" : "高牌";
  if (board.length < 3) return null;
  const evaluation = evaluateBestFiveCards([...holeCards, ...board].map(parseCard), variant);
  return HAND_CATEGORY_LABELS[evaluation.category];
}

type GameWithSummaryRelations = Prisma.GameSessionGetPayload<{
  include: { _count: { select: { handPlayerRecords: true } }; room: true; tableSeat: { select: { stack: true } } };
}>;

function gameSummary(game: GameWithSummaryRelations): GameSessionSummary {
  const active = game.status === "ACTIVE";
  const activeStack = game.tableSeat?.stack ?? game.detachedStack;
  if (active && activeStack === null) throw new ApiError(500, "PERSISTENCE_ERROR", "活动对局缺少当前后手");
  if (!active && !game.endedAt) throw new ApiError(500, "PERSISTENCE_ERROR", "已结束对局缺少结束时间");
  const currentStack = active ? activeStack : null;
  return GameSessionSummarySchema.parse({
    currentStack,
    endedAt: game.endedAt?.toISOString() ?? null,
    gameSessionId: game.id,
    handsPlayed: game._count.handPlayerRecords,
    netResult: active ? null : game.totalCashOut - game.totalBuyIn,
    provisionalNetResult: active ? currentStack! + game.totalCashOut - game.totalBuyIn : null,
    room: { roomCode: game.room.roomCode.trim(), roomId: game.room.id, roomName: game.room.name },
    seatIndex: game.seatIndex,
    startedAt: game.startedAt.toISOString(),
    status: game.status,
    totalBuyIn: game.totalBuyIn,
    totalCashOut: game.totalCashOut,
  });
}

type HistoryPlayerWithHand = Prisma.HandPlayerRecordGetPayload<{
  include: { hand: { include: { players: { select: { holeCardsPublic: true; holeCardsPublicReason: true; userId: true } }; pots: true; room: true; runouts: { include: { pots: true } } } } };
}>;

function handSummary(player: HistoryPlayerWithHand, runoutIndex: HistoryRunoutIndex | null): HandSummary {
  const hand = player.hand;
  const runout = runoutIndex === null ? null : hand.runouts.find((candidate) => candidate.runoutIndex === runoutIndex);
  if (runoutIndex !== null && !runout) throw new ApiError(500, "PERSISTENCE_ERROR", "发两次历史分支记录不完整");
  const pots = runout?.pots ?? hand.pots;
  const wonPots = pots.filter((pot) => pot.amount > 0 && pot.winners.includes(player.userId));
  const amounts = runoutIndex === null ? null : projectRunoutPlayerAmounts({
    committed: player.committed,
    pots,
    runoutIndex,
    startingStack: player.startingStack,
    userId: player.userId,
  });
  return HandSummarySchema.parse({
    board: runout?.board ?? hand.board,
    displayHandNumber: displayHandNumber(hand.handNumber, runoutIndex),
    endingStack: amounts?.endingStack ?? player.endingStack,
    finishReason: hand.finishReason,
    finishedAt: hand.finishedAt.toISOString(),
    handId: hand.id,
    handNumber: hand.handNumber,
    hiddenOpponentCount: hand.players.filter((candidate) => candidate.userId !== player.userId && !isPublicShowdown(candidate)).length,
    netResult: amounts?.netResult ?? player.netResult,
    ownHoleCards: assertCards(player.holeCards),
    paidCardRevealCost: hand.paidCardRevealCost,
    paidCardRevealEnabled: hand.paidCardRevealEnabled,
    room: { roomCode: hand.room.roomCode.trim(), roomId: hand.room.id, roomName: hand.room.name },
    runoutIndex,
    seatIndex: player.seatIndex,
    splitPot: wonPots.some((pot) => pot.winners.length > 1),
    startingStack: player.startingStack,
    viewerParticipated: true,
    wonAnyPot: wonPots.length > 0,
  });
}

function handSummaryBranches(player: HistoryPlayerWithHand): HandSummary[] {
  return runoutIndices(player.hand.runoutCount).map((runoutIndex) => handSummary(player, runoutIndex));
}

type RoomHandWithSummaryRelations = Prisma.HandRecordGetPayload<{
  include: { players: true; pots: true; room: true; runouts: { include: { pots: true } } };
}>;

function roomHandSummary(hand: RoomHandWithSummaryRelations, viewerUserId: string, runoutIndex: HistoryRunoutIndex | null): HandSummary {
  const viewer = hand.players.find((player) => player.userId === viewerUserId) ?? null;
  const runout = runoutIndex === null ? null : hand.runouts.find((candidate) => candidate.runoutIndex === runoutIndex);
  if (runoutIndex !== null && !runout) throw new ApiError(500, "PERSISTENCE_ERROR", "发两次历史分支记录不完整");
  const pots = runout?.pots ?? hand.pots;
  const wonPots = viewer ? pots.filter((pot) => pot.amount > 0 && pot.winners.includes(viewerUserId)) : [];
  const amounts = viewer && runoutIndex !== null ? projectRunoutPlayerAmounts({
    committed: viewer.committed,
    pots,
    runoutIndex,
    startingStack: viewer.startingStack,
    userId: viewerUserId,
  }) : null;
  return HandSummarySchema.parse({
    board: runout?.board ?? hand.board,
    displayHandNumber: displayHandNumber(hand.handNumber, runoutIndex),
    endingStack: amounts?.endingStack ?? viewer?.endingStack ?? null,
    finishReason: hand.finishReason,
    finishedAt: hand.finishedAt.toISOString(),
    handId: hand.id,
    handNumber: hand.handNumber,
    hiddenOpponentCount: hand.players.filter((candidate) => candidate.userId !== viewerUserId && !isPublicShowdown(candidate)).length,
    netResult: amounts?.netResult ?? viewer?.netResult ?? null,
    ownHoleCards: viewer ? assertCards(viewer.holeCards) : null,
    paidCardRevealCost: hand.paidCardRevealCost,
    paidCardRevealEnabled: hand.paidCardRevealEnabled,
    room: { roomCode: hand.room.roomCode.trim(), roomId: hand.room.id, roomName: hand.room.name },
    runoutIndex,
    seatIndex: viewer?.seatIndex ?? null,
    splitPot: viewer ? wonPots.some((pot) => pot.winners.length > 1) : pots.some((pot) => pot.amount > 0 && pot.winners.length > 1),
    startingStack: viewer?.startingStack ?? null,
    viewerParticipated: viewer !== null,
    wonAnyPot: viewer ? wonPots.length > 0 : null,
  });
}

function roomHandSummaryBranches(hand: RoomHandWithSummaryRelations, viewerUserId: string): HandSummary[] {
  return runoutIndices(hand.runoutCount).map((runoutIndex) => roomHandSummary(hand, viewerUserId, runoutIndex));
}

type AuthorizedHand = Prisma.HandRecordGetPayload<{
  include: {
    actions: true;
    hypotheticalRunout: true;
    hypotheticalRunoutPurchases: { select: { id: true } };
    paidHandRevealPurchases: { select: { id: true } };
    paidCardReveals: { select: { targetUserId: true } };
    players: { include: { user: { select: { nickname: true } } } };
    pots: true;
    room: true;
    runouts: { include: { pots: true } };
  };
}>;

function visiblePlayers(hand: AuthorizedHand, viewerUserId: string, runoutIndex: HistoryRunoutIndex | null): HandDetailPlayer[] {
  const purchased = new Set(hand.paidCardReveals.map((reveal) => reveal.targetUserId));
  const wholeHandEntitlement = hand.paidHandRevealPurchases.length > 0 || purchased.size > 0;
  const runout = runoutIndex === null ? null : hand.runouts.find((candidate) => candidate.runoutIndex === runoutIndex);
  if (runoutIndex !== null && !runout) throw new ApiError(404, "HAND_NOT_FOUND", "发两次历史分支不存在");
  return [...hand.players].sort((left, right) => left.seatIndex - right.seatIndex).map((player) => {
    const visibility = player.userId === viewerUserId
      ? "OWN" as const
      : isPublicShowdown(player)
        ? "PUBLIC_SHOWDOWN" as const
        : wholeHandEntitlement || purchased.has(player.userId)
          ? "PURCHASED" as const
          : "HIDDEN" as const;
    const cards = assertCards(player.holeCards);
    const board = runout?.board ?? hand.board;
    const amounts = runoutIndex === null ? null : projectRunoutPlayerAmounts({
      committed: player.committed,
      pots: runout!.pots,
      runoutIndex,
      startingStack: player.startingStack,
      userId: player.userId,
    });
    return {
      allIn: player.allIn,
      committed: amounts?.committed ?? player.committed,
      endingStack: amounts?.endingStack ?? player.endingStack,
      folded: player.folded,
      handLabel: visibility === "HIDDEN"
        ? null
        : historicalHandLabel(cards, board, hand.room.specialMode === "SHORT_DECK" ? "SHORT_DECK" : "STANDARD"),
      holeCards: visibility === "HIDDEN" ? null : cards,
      holeCardsVisibility: visibility,
      netResult: amounts?.netResult ?? player.netResult,
      nickname: player.user.nickname,
      seatIndex: player.seatIndex,
      startingStack: player.startingStack,
      userId: player.userId,
    } as HandDetailPlayer;
  });
}

function replayInput(hand: AuthorizedHand, players: readonly HandDetailPlayer[]) {
  const visibility = new Map(players.map((player) => [player.userId,
    player.holeCardsVisibility === "PUBLIC_VOLUNTARY" && player.holeCards.some((card) => card === null)
      ? "HIDDEN" as const
      : player.holeCardsVisibility,
  ]));
  const nickname = new Map(players.map((player) => [player.userId, player.nickname]));
  return {
    actions: [...hand.actions].sort((left, right) => left.sequence - right.sequence),
    hand: {
      bigBlindAmount: hand.bigBlindAmount,
      bigBlindSeat: hand.bigBlindSeat,
      board: hand.board,
      bombPotBlindAmount: hand.bombPotBlindAmount,
      buttonSeat: hand.buttonSeat,
      finishReason: hand.finishReason,
      id: hand.id,
      smallBlindAmount: hand.smallBlindAmount,
      smallBlindSeat: hand.smallBlindSeat,
    },
    players: hand.players.map((player) => ({
      allIn: player.allIn,
      committed: player.committed,
      endingStack: player.endingStack,
      folded: player.folded,
      holeCards: player.holeCards,
      holeCardsVisibility: visibility.get(player.userId) ?? "HIDDEN",
      nickname: nickname.get(player.userId) ?? player.user.nickname,
      seatIndex: player.seatIndex,
      startingStack: player.startingStack,
      userId: player.userId,
    })),
    pots: [...hand.pots].sort((left, right) => left.potIndex - right.potIndex),
  };
}

function fallbackEvents(hand: AuthorizedHand, runoutIndex: HistoryRunoutIndex | null = null): HistoryEvent[] {
  return [...hand.actions].sort((left, right) => left.sequence - right.sequence).map((action, index) => HistoryEventSchema.parse({
    actorSeat: action.seatIndex,
    actorUserId: action.userId,
    amount: action.amount === null || runoutIndex === null ? action.amount : splitForRunout(action.amount, runoutIndex),
    automatic: action.automatic,
    cards: null,
    potIndex: null,
    raiseTo: action.raiseTo === null || runoutIndex === null ? action.raiseTo : splitForRunout(action.raiseTo, runoutIndex),
    sequence: index,
    stateVersion: action.stateVersion,
    street: action.street,
    type: action.actionType === "FOLD" ? "PLAYER_FOLDED"
      : action.actionType === "CHECK" ? "PLAYER_CHECKED"
        : action.actionType === "CALL" ? "PLAYER_CALLED"
          : action.actionType === "BET" ? "PLAYER_BET"
            : action.actionType === "RAISE_TO" ? "PLAYER_RAISED"
              : "PLAYER_ALL_IN",
    visibility: null,
    winners: [],
  }));
}

export function createHistoryService(database: DatabaseClient) {
  async function authorizedHand(handId: string, viewerUserId: string): Promise<AuthorizedHand> {
    const hand = await database.handRecord.findFirst({
      include: {
        actions: { orderBy: { sequence: "asc" } },
        hypotheticalRunout: true,
        hypotheticalRunoutPurchases: { select: { id: true }, where: { buyerUserId: viewerUserId } },
        paidHandRevealPurchases: { select: { id: true }, where: { buyerUserId: viewerUserId } },
        paidCardReveals: { select: { targetUserId: true }, where: { buyerUserId: viewerUserId } },
        players: { include: { user: { select: { nickname: true } } }, orderBy: { seatIndex: "asc" } },
        pots: { orderBy: { potIndex: "asc" } },
        room: true,
        runouts: { include: { pots: { orderBy: { potIndex: "asc" } } }, orderBy: { runoutIndex: "asc" } },
      },
      where: { id: handId, room: { members: { some: { userId: viewerUserId } } } },
    });
    if (!hand) throw new ApiError(404, "HAND_NOT_FOUND", "历史牌局不存在");
    return hand;
  }

  async function listGames(userId: string, query: GameHistoryQuery) {
    const scope = gameCursorScope(query);
    const cursor = decodeCursor(query.cursor, "game", userId, scope);
    const games = await database.gameSession.findMany({
      include: { _count: { select: { handPlayerRecords: true } }, room: true, tableSeat: { select: { stack: true } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      where: {
        userId,
        ...(query.roomId ? { roomId: query.roomId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(cursor ? { OR: [{ startedAt: { lt: new Date(cursor.at) } }, { id: { lt: cursor.id }, startedAt: new Date(cursor.at) }] } : {}),
      },
    });
    const hasMore = games.length > query.limit;
    const page = games.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(gameSummary),
      nextCursor: hasMore && last ? encodeCursor({ at: last.startedAt.toISOString(), id: last.id, kind: "game", ownerId: userId, scope }) : null,
    };
  }

  return {
    listGames,

    async getGame(userId: string, gameSessionId: string) {
      const game = await database.gameSession.findFirst({
        include: {
          _count: { select: { handPlayerRecords: true } },
          handPlayerRecords: {
            include: {
              hand: {
                include: {
                  players: { select: { holeCardsPublic: true, holeCardsPublicReason: true, userId: true } },
                  pots: true,
                  room: true,
                  runouts: { include: { pots: true } },
                },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          room: true,
          tableSeat: { select: { stack: true } },
        },
        where: { id: gameSessionId, userId },
      });
      if (!game) throw new ApiError(404, "GAME_SESSION_NOT_FOUND", "对局记录不存在");
      return GameSessionDetailSchema.parse({ ...gameSummary(game), hands: game.handPlayerRecords.flatMap(handSummaryBranches) });
    },

    async listHands(userId: string, query: HandHistoryQuery) {
      const scope = handCursorScope(query);
      const cursor = decodeCursor(query.cursor, "hand", userId, scope);
      if (query.roomId) {
        const membership = await database.roomMember.findUnique({
          where: { roomId_userId: { roomId: query.roomId, userId } },
        });
        if (!membership) throw new ApiError(404, "HAND_NOT_FOUND", "历史牌局不存在");
        const filters: Prisma.HandRecordWhereInput[] = [{ roomId: query.roomId }];
        if (query.result === "win") filters.push({ players: { some: { netResult: { gt: 0 }, userId } } });
        if (query.result === "loss") filters.push({ players: { some: { netResult: { lt: 0 }, userId } } });
        if (query.result === "break-even") filters.push({ players: { some: { netResult: 0, userId } } });
        if (query.finishedFrom || query.finishedTo) filters.push({ finishedAt: { ...(query.finishedFrom ? { gte: new Date(query.finishedFrom) } : {}), ...(query.finishedTo ? { lte: new Date(query.finishedTo) } : {}) } });
        if (cursor) filters.push({ OR: [{ finishedAt: { lt: new Date(cursor.at) } }, { finishedAt: new Date(cursor.at), id: { lt: cursor.id } }] });
        const hands = await database.handRecord.findMany({
          include: { players: true, pots: true, room: true, runouts: { include: { pots: true } } },
          orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
          take: query.limit + 1,
          where: { AND: filters },
        });
        const hasMore = hands.length > query.limit;
        const page = hands.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.flatMap((hand) => roomHandSummaryBranches(hand, userId)),
          nextCursor: hasMore && last ? encodeCursor({ at: last.finishedAt.toISOString(), id: last.id, kind: "hand", ownerId: userId, scope }) : null,
        };
      }
      const filters: Prisma.HandPlayerRecordWhereInput[] = [{ userId }];
      if (query.roomId) filters.push({ roomId: query.roomId });
      if (query.result === "win") filters.push({ netResult: { gt: 0 } });
      if (query.result === "loss") filters.push({ netResult: { lt: 0 } });
      if (query.result === "break-even") filters.push({ netResult: 0 });
      if (query.finishedFrom || query.finishedTo) filters.push({ hand: { finishedAt: { ...(query.finishedFrom ? { gte: new Date(query.finishedFrom) } : {}), ...(query.finishedTo ? { lte: new Date(query.finishedTo) } : {}) } } });
      if (cursor) filters.push({ OR: [{ createdAt: { lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), handId: { lt: cursor.id } }] });
      const rows = await database.handPlayerRecord.findMany({
        include: {
          hand: {
            include: {
              players: { select: { holeCardsPublic: true, holeCardsPublicReason: true, userId: true } },
              pots: true,
              room: true,
              runouts: { include: { pots: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { handId: "desc" }],
        take: query.limit + 1,
        where: { AND: filters },
      });
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.flatMap(handSummaryBranches),
        nextCursor: hasMore && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.handId, kind: "hand", ownerId: userId, scope }) : null,
      };
    },

    async getHand(userId: string, handId: string, runoutIndex: HistoryRunoutIndex | null = null) {
      const hand = await authorizedHand(handId, userId);
      if (hand.runoutCount === 2 && runoutIndex === null) runoutIndex = 1;
      if (hand.runoutCount !== 2 && runoutIndex !== null) throw new ApiError(404, "HAND_NOT_FOUND", "发两次历史分支不存在");
      const runout = runoutIndex === null ? null : hand.runouts.find((candidate) => candidate.runoutIndex === runoutIndex);
      if (runoutIndex !== null && !runout) throw new ApiError(404, "HAND_NOT_FOUND", "发两次历史分支不存在");
      const players = visiblePlayers(hand, userId, runoutIndex);
      let actions: HistoryEvent[];
      if (runoutIndex !== null) {
        actions = fallbackEvents(hand, runoutIndex);
      } else try {
        actions = buildHandReplayTimeline(replayInput(hand, players)).events;
      } catch (error: unknown) {
        if (!(error instanceof ReplayNotAvailableError)) throw error;
        actions = fallbackEvents(hand);
      }
      const own = players.find((player) => player.userId === userId) ?? null;
      const pots = runout?.pots ?? hand.pots;
      const totalCommitted = runoutIndex === null
        ? hand.players.reduce((sum, player) => sum + player.committed, 0)
        : splitForRunout(hand.players.reduce((sum, player) => sum + player.committed, 0), runoutIndex);
      return HandDetailSchema.parse({
        actions,
        bigBlindAmount: hand.bigBlindAmount,
        bigBlindSeat: hand.bigBlindSeat,
        board: runout?.board ?? hand.board,
        bombPotBlindAmount: hand.bombPotBlindAmount,
        buttonSeat: hand.buttonSeat,
        finishReason: hand.finishReason,
        finishedAt: hand.finishedAt.toISOString(),
        handId: hand.id,
        handNumber: hand.handNumber,
        displayHandNumber: displayHandNumber(hand.handNumber, runoutIndex),
        hypotheticalRunout: runoutIndex === null && hand.hypotheticalRunout && hand.hypotheticalRunoutPurchases.length > 0 ? HypotheticalRunoutResultSchema.parse({
          actualBoard: hand.board,
          cards: hand.hypotheticalRunout.cards,
          createdAt: hand.hypotheticalRunout.createdAt.toISOString(),
          generationSource: hand.hypotheticalRunout.generationSource,
          handId: hand.id,
          simulatedBoard: [...hand.board, ...hand.hypotheticalRunout.cards],
        }) : null,
        ownResult: own?.netResult ?? null,
        paidRevealConfig: { cost: hand.paidCardRevealCost, enabled: hand.paidCardRevealEnabled },
        reviewEndsAt: hand.reviewEndsAt?.toISOString() ?? null,
        players,
        pots: pots.map((pot) => ({
          amount: pot.amount,
          contributors: pot.contributors,
          eligiblePlayers: pot.eligiblePlayers,
          oddChipRecipients: pot.oddChipRecipients,
          potIndex: pot.potIndex,
          winners: pot.winners,
        })),
        room: { roomCode: hand.room.roomCode.trim(), roomId: hand.room.id, roomName: hand.room.name },
        runoutIndex,
        settlement: {
          totalCommitted,
          totalPot: pots.reduce((sum, pot) => sum + pot.amount, 0),
          uncalledReturnTotal: Math.max(0, totalCommitted - pots.reduce((sum, pot) => sum + pot.amount, 0)),
          winnerUserIds: [...new Set(pots.filter((pot) => pot.amount > 0).flatMap((pot) => pot.winners))],
        },
        smallBlindAmount: hand.smallBlindAmount,
        smallBlindSeat: hand.smallBlindSeat,
        startedAt: hand.startedAt.toISOString(),
      });
    },

    async getReplay(userId: string, handId: string) {
      const hand = await authorizedHand(handId, userId);
      if (hand.runoutCount === 2) throw new ApiError(409, "REPLAY_NOT_AVAILABLE", "发两次牌局请分别查看两副历史牌面");
      const players = visiblePlayers(hand, userId, null);
      try {
        return HandReplaySchema.parse(buildHandReplayTimeline(replayInput(hand, players)));
      } catch (error: unknown) {
        if (error instanceof ReplayNotAvailableError) throw new ApiError(409, "REPLAY_NOT_AVAILABLE", "此历史牌局没有完整回放数据");
        throw error;
      }
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
