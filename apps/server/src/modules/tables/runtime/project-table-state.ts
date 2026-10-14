import { HandCategory, buildDisplayPotAmounts, evaluateBestFiveCards, getLegalActions, serializeCard } from "@paiyouju/poker-core";
import { DEFAULT_AVATAR_ID, PROTOCOL_VERSION, tableDiamondFees, type ProjectedHand, type ProjectedSeat, type TableStateProjection } from "@paiyouju/shared";

import type { TableRuntime } from "./table-runtime.js";
import { projectDomainEvent } from "./project-domain-event.js";

const PREFLOP_RANK_LABELS: Readonly<Record<number, string>> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

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

function preflopLabel(cards: readonly { readonly rank: number; readonly suit: string }[]): string {
  const [first, second] = cards;
  if (!first || !second) return "等待发牌";
  const rank = PREFLOP_RANK_LABELS[Math.max(first.rank, second.rank)] ?? String(Math.max(first.rank, second.rank));
  if (first.rank === second.rank) return `一对 ${rank}`;
  return `${rank} 高${first.suit === second.suit ? " · 同花起手" : ""}`;
}

function chipRecipientUserIds(state: NonNullable<TableRuntime["lastCompletedHand"]>["state"]): readonly string[] {
  const recipients = new Set(state.settlement?.winners ?? []);
  for (const event of state.actionHistory) {
    if (event.eventType === "POT_AWARDED" && (event.amount ?? 0) > 0) {
      for (const winner of event.winners ?? []) recipients.add(winner);
    }
    if (event.eventType === "UNCALLED_BET_RETURNED" && (event.amount ?? 0) > 0 && event.playerId) recipients.add(event.playerId);
  }
  return [...recipients];
}

export function projectTableStateForUser(
  runtime: TableRuntime,
  userId: string,
): TableStateProjection {
  const projectedRuntimeHand = runtime.status === "PERSISTENCE_ERROR" || runtime.status === "RECOVERY_ERROR"
    ? null
    : runtime.currentHand ?? runtime.postHandReview?.hand ?? null;
  const handState = projectedRuntimeHand?.state ?? null;
  const handPlayersByUser = new Map(
    handState?.players.map((player) => [player.playerId, player] as const) ?? [],
  );
  const review = runtime.postHandReview;
  const voluntarilyRevealedCardIndicesByUser = review?.voluntarilyRevealedCardIndicesByUser
    ?? Object.fromEntries((review?.voluntarilyRevealedUserIds ?? []).map((revealedUserId) => [revealedUserId, [0, 1] as const]));
  const publicHandLabel = (userIdToProject: string): string | null => {
    if (!handState) return null;
    const player = handPlayersByUser.get(userIdToProject);
    if (!player) return null;
    const fullyPublic = player.holeCardsVisibility === "showdown"
      || (voluntarilyRevealedCardIndicesByUser[userIdToProject]?.length ?? 0) === 2;
    const cards = [...player.holeCards, ...handState.board];
    if (!fullyPublic || cards.length < 5) return null;
    return HAND_CATEGORY_LABELS[evaluateBestFiveCards(cards, handState.config.variant).category];
  };
  const voluntaryIndicesFor = (userIdToProject: string): readonly (0 | 1)[] =>
    handPlayersByUser.get(userIdToProject)?.holeCardsVisibility === "showdown"
      ? []
      : voluntarilyRevealedCardIndicesByUser[userIdToProject] ?? [];
  const seats: ProjectedSeat[] = [...runtime.seats.values()]
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((seat) => {
      const player = handPlayersByUser.get(seat.userId);
      return {
        avatarId: seat.avatarId ?? DEFAULT_AVATAR_ID,
        committedThisHand: player?.committedThisHand ?? 0,
        committedThisStreet: player?.committedThisStreet ?? 0,
        connected: runtime.isConnected(seat.userId),
        hasFolded: player?.hasFolded ?? false,
        isAllIn: player?.isAllIn ?? false,
        isBigBlind: handState?.bigBlindSeat === seat.seatIndex,
        isCurrentActor: handState?.currentActorSeat === seat.seatIndex,
        isDealer: handState?.buttonSeat === seat.seatIndex,
        isSmallBlind: handState?.smallBlindSeat === seat.seatIndex,
        nickname: seat.nickname,
        playStatus: seat.playStatus,
        publicHandLabel: publicHandLabel(seat.userId),
        reservedAwayEndsAt: seat.reservedAwayEndsAt?.toISOString() ?? null,
        seatIndex: seat.seatIndex,
        stack: projectedRuntimeHand === runtime.currentHand && player ? player.stack : seat.stack,
        startingStack: player?.startingStack ?? null,
        squidMarked: seat.squidMarked ?? false,
        squidRoundParticipant: seat.squidRoundParticipant ?? false,
        userId: seat.userId,
        voluntarilyRevealed: voluntaryIndicesFor(seat.userId).length > 0,
        voluntarilyRevealedCardIndices: [...voluntaryIndicesFor(seat.userId)],
      };
    });

  let hand: ProjectedHand | null = null;
  if (projectedRuntimeHand && handState) {
    const recipient = handPlayersByUser.get(userId);
    const publicHoleCardSlots = Object.fromEntries(
      handState.players
        .flatMap((player) => {
          const cards = player.holeCards.map(serializeCard) as [string, string];
          if (player.holeCardsVisibility === "showdown") return [[player.playerId, cards] as const];
          const indices = voluntaryIndicesFor(player.playerId);
          if (indices.length === 0) return [];
          const slots: [string | null, string | null] = [
            indices.includes(0) ? cards[0] : null,
            indices.includes(1) ? cards[1] : null,
          ];
          return [[player.playerId, slots] as const];
        }),
    );
    const publicHoleCards = Object.fromEntries(
      Object.entries(publicHoleCardSlots)
        .filter((entry): entry is [string, [string, string]] => entry[1][0] !== null && entry[1][1] !== null),
    );
    const legalActions = recipient?.seatIndex === handState.currentActorSeat
      ? getLegalActions(handState, userId)
      : null;
    const projectedPots = handState.status === "finished"
      ? handState.pots.map((pot) => pot.amount)
      : buildDisplayPotAmounts(handState.players);
    const runoutResults: ProjectedHand["runoutResults"] = handState.settlement?.runouts ? handState.settlement.runouts.map((runout) => ({
      ownNetResult: recipient
        ? (runout.awardsByPlayer[userId] ?? 0) - (runout.runoutIndex === 1
            ? Math.ceil(recipient.committedThisHand / 2)
            : Math.floor(recipient.committedThisHand / 2))
        : null,
      runoutIndex: runout.runoutIndex,
      totalPot: runout.pots.reduce((sum, pot) => sum + pot.amount, 0),
      winnerUserIds: [...runout.winners],
    })) as ProjectedHand["runoutResults"] : null;
    hand = {
      actionHistory: handState.actionHistory.map(projectDomainEvent),
      board: handState.board.map(serializeCard),
      bombPotBlind: handState.bombPotBlind ?? null,
      currentBet: handState.currentBet,
      currentActorSeat: handState.currentActorSeat,
      handId: handState.handId,
      handNumber: projectedRuntimeHand.handNumber,
      legalActions,
      mainPot: projectedPots[0] ?? 0,
      ownHoleCards: recipient ? recipient.holeCards.map(serializeCard) : [],
      publicHoleCardSlots,
      publicHoleCards,
      runoutBoards: handState.runoutBoards?.map((board) => board.map(serializeCard)) as ProjectedHand["runoutBoards"] ?? null,
      runoutResults,
      runoutVote: projectedRuntimeHand.runoutVote ? {
        deadlineAt: projectedRuntimeHand.runoutVote.deadlineAt.toISOString(),
        eligibleUserIds: [...projectedRuntimeHand.runoutVote.eligibleUserIds],
        ownChoice: projectedRuntimeHand.runoutVote.choicesByUser[userId] ?? null,
        respondedUserIds: Object.keys(projectedRuntimeHand.runoutVote.choicesByUser).sort(),
      } : null,
      sidePots: projectedPots.slice(1),
      street: handState.street,
      turnDeadlineAt: projectedRuntimeHand.turnDeadlineAt?.toISOString() ?? null,
    };
  }

  const recipientSeat = [...runtime.seats.values()].find((seat) => seat.userId === userId);
  const recipientPlayer = handPlayersByUser.get(userId);
  const voluntarilyRevealedUserIds = review?.voluntarilyRevealedUserIds ?? [];
  const lastHandState = review?.hand.state ?? runtime.lastCompletedHand?.state ?? null;
  const lastHand = review?.hand ?? runtime.lastCompletedHand;
  const ownSummary = (() => {
    if (!recipientPlayer) return null;
    const cards = [...recipientPlayer.holeCards, ...(handState?.board ?? [])];
    if (cards.length < 5) return { category: "PREFLOP" as const, label: preflopLabel(recipientPlayer.holeCards) };
    const evaluation = evaluateBestFiveCards(cards, handState?.config.variant);
    const categories = {
      [HandCategory.HighCard]: "HIGH_CARD",
      [HandCategory.OnePair]: "ONE_PAIR",
      [HandCategory.TwoPair]: "TWO_PAIR",
      [HandCategory.ThreeOfAKind]: "THREE_OF_A_KIND",
      [HandCategory.Straight]: "STRAIGHT",
      [HandCategory.Flush]: "FLUSH",
      [HandCategory.FullHouse]: "FULL_HOUSE",
      [HandCategory.FourOfAKind]: "FOUR_OF_A_KIND",
      [HandCategory.StraightFlush]: "STRAIGHT_FLUSH",
    } as const;
    return { category: categories[evaluation.category], label: HAND_CATEGORY_LABELS[evaluation.category] };
  })();
  const eligibleSeats = [...runtime.seats.values()].filter((seat) => seat.playStatus === "ACTIVE" && seat.stack > 0);
  const tableRunState: TableStateProjection["tableRunState"] = runtime.status === "PERSISTENCE_ERROR" || runtime.status === "RECOVERY_ERROR"
    ? "ERROR"
    : runtime.room.status === "CLOSED"
      ? "CLOSED"
    : runtime.room.status === "CLOSING"
        ? "CLOSING"
        : runtime.room.nextHandPaused
          ? "PAUSED"
          : eligibleSeats.length < 2
            ? "STOPPED_INSUFFICIENT_PLAYERS"
            : runtime.room.requiresManualStart
              ? "WAITING_FOR_OWNER"
              : "RUNNING";
  const autoCallCurrentBet = recipientSeat?.nextActionAutoCallCurrentBet ?? null;
  const projectedAutoCallAmount = recipientPlayer && autoCallCurrentBet !== null
    ? Math.min(recipientPlayer.stack, Math.max(0, autoCallCurrentBet - recipientPlayer.committedThisStreet))
    : 0;
  const nextActionAutopilot: TableStateProjection["nextActionAutopilot"] = !recipientSeat?.nextActionAutopilotArmed
    ? null
    : autoCallCurrentBet === null
      ? { mode: "CHECK_OR_FOLD" }
      : projectedAutoCallAmount > 0
        ? { callAmount: projectedAutoCallAmount, currentBet: autoCallCurrentBet, mode: "CALL" }
        : null;

  return {
    bustedRebuyRequired: ["NORMAL", "BOMB_POT"].includes(runtime.room.specialMode ?? "NORMAL") && recipientSeat?.playStatus === "BUSTED_WAITING_REBUY",
    canOwnerStart: runtime.room.ownerId === userId
      && runtime.room.status === "OPEN"
      && (runtime.room.requiresManualStart ?? false)
      && eligibleSeats.length >= 2
      && !runtime.currentHand
      && !runtime.postHandReview,
    canRevealOwnCards: Boolean(
      runtime.currentHand?.state.status === "active"
        ? runtime.currentHand.state.players.some((player) => player.playerId === userId)
        : runtime.postHandReview?.hand.state.players.some(
          (player) => player.playerId === userId && player.holeCardsVisibility !== "showdown",
        )
    ),
    hand,
    lastHandSummary: lastHand && lastHandState ? {
      handId: lastHandState.handId,
      handNumber: lastHand.handNumber,
      ownNetResult: lastHandState.players.find((player) => player.playerId === userId)
        ? (lastHandState.players.find((player) => player.playerId === userId)!.stack - lastHandState.players.find((player) => player.playerId === userId)!.startingStack)
        : null,
      voluntarilyRevealedUserIds: [...voluntarilyRevealedUserIds],
      winnerUserIds: [...chipRecipientUserIds(lastHandState)],
    } : null,
    nextActionAutopilot,
    nextActionAutopilotArmed: recipientSeat?.nextActionAutopilotArmed ?? false,
    ownHandSummary: ownSummary,
    pendingShowCardIndices: [...(recipientSeat?.pendingShowCardIndices ?? [])],
    postHandReviewEndsAt: review?.endsAt.toISOString() ?? null,
    presenceVersion: runtime.presenceVersion,
    protocolVersion: PROTOCOL_VERSION,
    recipient: { isOwner: runtime.room.ownerId === userId, userId },
    reservedAwayEndsAt: recipientSeat?.reservedAwayEndsAt?.toISOString() ?? null,
    room: {
      actionTimeSeconds: runtime.room.actionTimeSeconds,
      bigBlind: runtime.room.bigBlind,
      bombPotBlindMultiplier: runtime.room.bombPotBlindMultiplier ?? null,
      bombPotIntervalMinutes: runtime.room.bombPotIntervalMinutes ?? null,
      bombPotNextAt: runtime.room.bombPotNextAt?.toISOString() ?? null,
      durationMinutes: runtime.room.durationMinutes,
      expiresAt: runtime.room.expiresAt.toISOString(),
      initialBuyIn: runtime.room.initialBuyIn
        ?? Math.min(runtime.room.maximumBuyIn, Math.max(runtime.room.minimumBuyIn, runtime.room.bigBlind * 100)),
      maximumBuyIn: runtime.room.maximumBuyIn,
      maxSeats: runtime.room.maxSeats,
      minimumBuyIn: runtime.room.minimumBuyIn,
      name: runtime.room.name,
      nextHandPaused: runtime.room.nextHandPaused,
      pointFeeRates: tableDiamondFees(),
      requiresManualStart: runtime.room.requiresManualStart ?? true,
      runItTwiceEnabled: runtime.room.runItTwiceEnabled ?? false,
      roomCode: runtime.room.roomCode,
      roomId: runtime.room.roomId,
      smallBlind: runtime.room.smallBlind,
      specialMode: runtime.room.specialMode ?? "NORMAL",
      status: runtime.room.status,
      squidRoundGraceEndsAt: runtime.room.squidRoundGraceEndsAt?.toISOString() ?? null,
      squidRoundNumber: runtime.room.squidRoundNumber ?? 1,
      squidStake: runtime.room.squidStake ?? null,
      tableStartedAt: runtime.room.tableStartedAt?.toISOString() ?? null,
    },
    runtimeStatus: runtime.status,
    seats,
    startCountdownAt: runtime.startCountdownAt?.toISOString() ?? null,
    stateVersion: runtime.stateVersion,
    tableRunState,
    trusteeshipEnabled: recipientSeat?.trusteeshipEnabled ?? false,
  };
}
