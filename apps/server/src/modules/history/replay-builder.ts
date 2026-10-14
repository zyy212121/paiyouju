import {
  HandReplaySchema,
  HistoryEventSchema,
  type HandReplay,
  type HistoryEvent,
  type ReplayPlayer,
  type ReplayInitialState,
  type ReplayState,
  reduceReplayEvents,
} from "@paiyouju/shared";

export class ReplayNotAvailableError extends Error {
  constructor(readonly reason: string) {
    super("历史牌局没有完整回放数据");
    this.name = "ReplayNotAvailableError";
  }
}

interface ReplayHandRecord {
  readonly bigBlindAmount: number;
  readonly bigBlindSeat: number;
  readonly board: readonly string[];
  readonly bombPotBlindAmount?: number | null;
  readonly buttonSeat: number;
  readonly finishReason: "FOLD_TO_WIN" | "SHOWDOWN";
  readonly id: string;
  readonly smallBlindAmount: number;
  readonly smallBlindSeat: number;
}

interface ReplayPlayerRecord {
  readonly allIn: boolean;
  readonly committed: number;
  readonly endingStack: number;
  readonly folded: boolean;
  readonly holeCards: readonly string[];
  readonly holeCardsVisibility: "OWN" | "PUBLIC_SHOWDOWN" | "PUBLIC_VOLUNTARY" | "PURCHASED" | "HIDDEN";
  readonly nickname: string;
  readonly seatIndex: number;
  readonly startingStack: number;
  readonly userId: string;
}

interface ReplayActionRecord {
  readonly actionType: "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE_TO" | "ALL_IN";
  readonly amount: number | null;
  readonly automatic: boolean;
  readonly raiseTo: number | null;
  readonly seatIndex: number;
  readonly sequence: number;
  readonly stateVersion: number;
  readonly street: "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";
  readonly userId: string;
}

interface ReplayPotRecord {
  readonly amount: number;
  readonly contributors: readonly string[];
  readonly eligiblePlayers: readonly string[];
  readonly oddChipRecipients: readonly string[];
  readonly potIndex: number;
  readonly winners: readonly string[];
}

interface ReplayActorValidationState {
  actedThisStreet: boolean;
  allIn: boolean;
  contributed: number;
  folded: boolean;
}

export interface BuildReplayInput {
  readonly actions: readonly ReplayActionRecord[];
  readonly hand: ReplayHandRecord;
  readonly players: readonly ReplayPlayerRecord[];
  readonly pots: readonly ReplayPotRecord[];
}

function unavailable(reason: string): never {
  throw new ReplayNotAvailableError(reason);
}

function validInteger(value: number, minimum = 0): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= 2_000_000_000;
}

const CARD_CODE_PATTERN = /^[2-9TJQKA][cdhs]$/;

function eventFactory(events: HistoryEvent[]) {
  return (type: HistoryEvent["type"], street: HistoryEvent["street"], values: Partial<HistoryEvent> = {}) => {
    const event = HistoryEventSchema.parse({
      actorSeat: null,
      actorUserId: null,
      amount: null,
      automatic: false,
      cards: null,
      potIndex: null,
      raiseTo: null,
      sequence: events.length,
      stateVersion: null,
      street,
      type,
      visibility: null,
      winners: [],
      ...values,
    });
    events.push(event);
  };
}

function awardMap(pots: readonly ReplayPotRecord[]): Map<string, number> {
  const awards = new Map<string, number>();
  for (const pot of pots) {
    if (!validInteger(pot.amount, 1) || pot.winners.length === 0) unavailable("invalid-pot-award");
    const uniqueWinners = new Set(pot.winners);
    const uniqueOdd = new Set(pot.oddChipRecipients);
    if (uniqueWinners.size !== pot.winners.length || uniqueOdd.size !== pot.oddChipRecipients.length) unavailable("duplicate-pot-recipient");
    const remainder = pot.amount % pot.winners.length;
    if (pot.oddChipRecipients.length !== remainder || pot.oddChipRecipients.some((userId) => !uniqueWinners.has(userId))) unavailable("invalid-odd-chip-recipients");
    const base = Math.floor(pot.amount / pot.winners.length);
    for (const winner of pot.winners) awards.set(winner, (awards.get(winner) ?? 0) + base);
    for (const winner of pot.oddChipRecipients) awards.set(winner, (awards.get(winner) ?? 0) + 1);
  }
  return awards;
}

interface ExpectedPot {
  amount: number;
  contributors: string[];
  eligiblePlayers: string[];
}

function appendUnique(values: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...values, ...additions])];
}

function expectedSettlementStructure(
  players: readonly ReplayPlayerRecord[],
  mergeEquivalentPots: boolean,
  legacyReturns: boolean,
): {
  readonly pots: readonly ExpectedPot[];
  readonly returns: ReadonlyMap<string, number>;
} {
  const levels = [...new Set(players.map((player) => player.committed).filter((amount) => amount > 0))]
    .sort((left, right) => left - right);
  const expectedPots: ExpectedPot[] = [];
  const returns = new Map<string, number>();
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.committed >= level);
    const amount = (level - previous) * contributors.length;
    const contributorIds = contributors.map((player) => player.userId);
    const eligiblePlayers = contributors.filter((player) => !player.folded).map((player) => player.userId);
    const soleContributor = contributors.length === 1 ? contributors[0] : undefined;
    if (legacyReturns && soleContributor !== undefined && !soleContributor.folded) {
      returns.set(soleContributor.userId, (returns.get(soleContributor.userId) ?? 0) + amount);
    } else if (amount > 0) {
      if (eligiblePlayers.length === 0) {
        const last = expectedPots.at(-1);
        if (!last) unavailable("dead-money-without-pot");
        last.amount += amount;
        last.contributors = appendUnique(last.contributors, contributorIds);
      } else {
        const last = expectedPots.at(-1);
        if (mergeEquivalentPots && last && sameMembers(last.eligiblePlayers, eligiblePlayers)) {
          last.amount += amount;
          last.contributors = appendUnique(last.contributors, contributorIds);
        } else {
          expectedPots.push({ amount, contributors: contributorIds, eligiblePlayers });
        }
      }
    }
    previous = level;
  }
  return { pots: expectedPots, returns };
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function projectedInitialPlayer(player: ReplayPlayerRecord): ReplayPlayer {
  const own = player.holeCardsVisibility === "OWN";
  return {
    allIn: false,
    committed: 0,
    folded: false,
    holeCards: own ? [player.holeCards[0]!, player.holeCards[1]!] : null,
    holeCardsVisibility: own ? "OWN" : "HIDDEN",
    nickname: player.nickname,
    seatIndex: player.seatIndex,
    stack: player.startingStack,
    userId: player.userId,
  };
}

function orderedBoardEvents(
  board: readonly string[],
  currentStreet: "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN",
  targetStreet: "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN",
  add: ReturnType<typeof eventFactory>,
): "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" {
  const order = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"] as const;
  let currentIndex = order.indexOf(currentStreet);
  const targetIndex = order.indexOf(targetStreet);
  if (targetIndex < currentIndex) unavailable("action-street-regression");
  while (currentIndex < targetIndex) {
    currentIndex += 1;
    const next = order[currentIndex]!;
    if (next === "FLOP") {
      if (board.length < 3) unavailable("missing-flop");
      add("FLOP_DEALT", "FLOP", { cards: board.slice(0, 3) });
    } else if (next === "TURN") {
      if (board.length < 4) unavailable("missing-turn");
      add("TURN_DEALT", "TURN", { cards: [board[3]!] });
    } else if (next === "RIVER") {
      if (board.length < 5) unavailable("missing-river");
      add("RIVER_DEALT", "RIVER", { cards: [board[4]!] });
    }
  }
  return order[currentIndex]!;
}

function actionEventType(action: ReplayActionRecord): HistoryEvent["type"] {
  switch (action.actionType) {
    case "FOLD": return "PLAYER_FOLDED";
    case "CHECK": return "PLAYER_CHECKED";
    case "CALL": return "PLAYER_CALLED";
    case "BET": return "PLAYER_BET";
    case "RAISE_TO": return "PLAYER_RAISED";
    case "ALL_IN": return "PLAYER_ALL_IN";
  }
}

export function buildHandReplayTimeline(input: BuildReplayInput): HandReplay {
  const { actions, hand, players, pots } = input;
  if (players.length < 2 || players.length > 9) unavailable("invalid-player-count");
  if (![0, 3, 4, 5].includes(hand.board.length)) unavailable("invalid-board-length");
  if (hand.finishReason === "SHOWDOWN" && hand.board.length !== 5) unavailable("incomplete-showdown-board");
  if (!validInteger(hand.smallBlindAmount, 1) || !validInteger(hand.bigBlindAmount, 1) || hand.smallBlindAmount >= hand.bigBlindAmount) unavailable("invalid-blinds");
  const bombPotBlind = hand.bombPotBlindAmount ?? null;
  if (bombPotBlind !== null && !validInteger(bombPotBlind, 1)) unavailable("invalid-bomb-pot-blind");

  const userIds = new Set(players.map((player) => player.userId));
  const seats = new Set(players.map((player) => player.seatIndex));
  if (userIds.size !== players.length || seats.size !== players.length) unavailable("duplicate-player");
  if (!seats.has(hand.buttonSeat) || !seats.has(hand.smallBlindSeat) || !seats.has(hand.bigBlindSeat) || hand.smallBlindSeat === hand.bigBlindSeat) unavailable("invalid-position");
  for (const player of players) {
    if (!validInteger(player.startingStack, 1) || !validInteger(player.endingStack) || !validInteger(player.committed)) unavailable("invalid-player-points");
    if (player.holeCards.length !== 2) unavailable("missing-hole-cards");
  }
  const physicalCards = [...hand.board, ...players.flatMap((player) => player.holeCards)];
  if (physicalCards.some((card) => !CARD_CODE_PATTERN.test(card)) || new Set(physicalCards).size !== physicalCards.length) unavailable("invalid-or-duplicate-card");

  const postedBlindFor = (player: ReplayPlayerRecord) => bombPotBlind !== null
    ? Math.min(player.startingStack, bombPotBlind)
    : player.seatIndex === hand.smallBlindSeat
      ? Math.min(player.startingStack, hand.smallBlindAmount)
      : player.seatIndex === hand.bigBlindSeat
        ? Math.min(player.startingStack, hand.bigBlindAmount)
        : 0;
  const actorStates = new Map<string, ReplayActorValidationState>(players.map((player) => {
    const postedBlind = postedBlindFor(player);
    return [player.userId, { actedThisStreet: false, allIn: postedBlind === player.startingStack, contributed: postedBlind, folded: false }];
  }));
  const streetOrder = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"] as const;
  let validationStreet: ReplayActionRecord["street"] = bombPotBlind === null ? "PREFLOP" : "FLOP";
  let streetContributions = new Map(players.map((player) => [player.userId, bombPotBlind === null ? postedBlindFor(player) : 0]));
  let currentBet = Math.max(...streetContributions.values());
  let terminalStreet: ReplayActionRecord["street"] | null = null;
  const bettingRoundComplete = () => players.every((player) => {
    const state = actorStates.get(player.userId)!;
    return state.folded || state.allIn || (state.actedThisStreet && streetContributions.get(player.userId) === currentBet);
  });
  const automaticRunoutReady = () => {
    const actionable = players.filter((player) => {
      const state = actorStates.get(player.userId)!;
      return !state.folded && !state.allIn;
    });
    return actionable.length <= 1
      && (actionable[0] === undefined || (streetContributions.get(actionable[0].userId) ?? 0) >= currentBet);
  };
  let automaticRunoutStreet: ReplayActionRecord["street"] | null = automaticRunoutReady() ? validationStreet : null;
  for (const [index, action] of actions.entries()) {
    if (terminalStreet !== null) unavailable("action-after-hand-terminal");
    if (automaticRunoutStreet !== null) unavailable("action-after-automatic-runout");
    if (action.street === "SHOWDOWN") unavailable("player-action-at-showdown");
    if (action.sequence !== index + 1 || !userIds.has(action.userId) || !seats.has(action.seatIndex)) unavailable("invalid-action-sequence-or-actor");
    const actor = players.find((player) => player.userId === action.userId);
    if (actor?.seatIndex !== action.seatIndex) unavailable("action-seat-mismatch");
    if (action.stateVersion !== index + 2) unavailable("invalid-action-state-version");
    const paid = ["CALL", "BET", "RAISE_TO", "ALL_IN"].includes(action.actionType);
    if (paid !== (action.amount !== null) || (action.amount !== null && !validInteger(action.amount, 1))) unavailable("invalid-action-amount");
    if ((action.actionType === "RAISE_TO") !== (action.raiseTo !== null) || (action.raiseTo !== null && !validInteger(action.raiseTo, 1))) unavailable("invalid-raise-shape");
    const nextStreetIndex = streetOrder.indexOf(action.street);
    const currentStreetIndex = streetOrder.indexOf(validationStreet);
    if (nextStreetIndex < currentStreetIndex) unavailable("action-street-regression");
    if (nextStreetIndex > currentStreetIndex) {
      if (nextStreetIndex !== currentStreetIndex + 1) unavailable("action-street-gap");
      if (automaticRunoutReady()) unavailable("action-after-automatic-runout");
      if (!bettingRoundComplete()) unavailable("incomplete-betting-round");
      validationStreet = action.street;
      streetContributions = new Map(players.map((player) => [player.userId, 0]));
      currentBet = 0;
      for (const state of actorStates.values()) state.actedThisStreet = false;
    }
    const streetContributionBefore = streetContributions.get(action.userId) ?? 0;
    if (action.actionType === "RAISE_TO" && action.raiseTo !== streetContributionBefore + action.amount!) unavailable("raise-to-amount-mismatch");
    const actorState = actorStates.get(action.userId)!;
    if (actorState.folded || actorState.allIn) unavailable("action-after-terminal-player-state");
    const remainingStack = actor!.startingStack - actorState.contributed;
    const streetContributionAfter = streetContributionBefore + (action.amount ?? 0);
    if (action.actionType === "CHECK" && streetContributionBefore !== currentBet) unavailable("illegal-check-facing-bet");
    if (action.actionType === "CALL") {
      const expectedCall = Math.min(Math.max(0, currentBet - streetContributionBefore), remainingStack);
      if (expectedCall === 0 || action.amount !== expectedCall) unavailable("invalid-call-amount");
    }
    if (action.actionType === "BET" && (currentBet !== 0 || streetContributionAfter < hand.bigBlindAmount)) unavailable("invalid-bet");
    if (action.actionType === "RAISE_TO" && action.raiseTo! <= currentBet) unavailable("invalid-raise-target");
    if (action.actionType === "ALL_IN" && action.amount !== remainingStack) unavailable("incomplete-all-in-action");
    if (action.amount !== null) {
      actorState.contributed += action.amount;
      streetContributions.set(action.userId, streetContributionBefore + action.amount);
      if (actorState.contributed > actor!.startingStack) unavailable("action-contribution-exceeds-stack");
      if (actorState.contributed === actor!.startingStack) actorState.allIn = true;
    }
    if (action.actionType === "FOLD") actorState.folded = true;
    if (streetContributionAfter > currentBet) {
      currentBet = streetContributionAfter;
      for (const [userId, state] of actorStates) {
        if (userId !== action.userId && !state.folded && !state.allIn) state.actedThisStreet = false;
      }
    }
    actorState.actedThisStreet = true;
    if ([...actorStates.values()].filter((state) => !state.folded).length === 1) terminalStreet = action.street;
    else if (automaticRunoutReady()) automaticRunoutStreet = action.street;
  }
  const boardLengthForStreet: Readonly<Record<"PREFLOP" | "FLOP" | "TURN" | "RIVER", number>> = {
    FLOP: 3,
    PREFLOP: 0,
    RIVER: 5,
    TURN: 4,
  };
  if (hand.finishReason === "FOLD_TO_WIN") {
    if (terminalStreet === null || automaticRunoutStreet !== null || hand.board.length !== boardLengthForStreet[terminalStreet]) unavailable("invalid-fold-terminal-street");
    if (players.some((player) => player.holeCardsVisibility === "PUBLIC_SHOWDOWN")) unavailable("public-showdown-on-fold-finish");
  } else {
    if (terminalStreet !== null) unavailable("showdown-after-uncontested-terminal");
    if (automaticRunoutStreet === null && (validationStreet !== "RIVER" || !bettingRoundComplete())) unavailable("incomplete-showdown-actions");
  }
  for (const [index, pot] of pots.entries()) {
    if (pot.potIndex !== index) unavailable("invalid-pot-sequence");
    if ([...pot.contributors, ...pot.eligiblePlayers, ...pot.winners].some((userId) => !userIds.has(userId))) unavailable("unknown-pot-player");
    if ([pot.contributors, pot.eligiblePlayers, pot.winners, pot.oddChipRecipients].some((members) => new Set(members).size !== members.length)) unavailable("duplicate-pot-member");
    if (pot.eligiblePlayers.some((userId) => !pot.contributors.includes(userId))) unavailable("ineligible-pot-player");
    if (pot.winners.some((userId) => !pot.eligiblePlayers.includes(userId))) unavailable("ineligible-winner");
  }

  const expected = [false, true]
    .flatMap((legacyReturns) => [true, false]
      .map((mergeEquivalentPots) => expectedSettlementStructure(players, mergeEquivalentPots, legacyReturns)))
    .find((candidate) => pots.length === candidate.pots.length && pots.every((pot, index) => {
      const layer = candidate.pots[index]!;
      return pot.amount === layer.amount
        && sameMembers(pot.contributors, layer.contributors)
        && sameMembers(pot.eligiblePlayers, layer.eligiblePlayers);
    }));
  if (!expected) unavailable("pot-layer-mismatch");

  const awards = awardMap(pots);
  const returns = new Map<string, number>();
  for (const player of players) {
    const amount = player.endingStack - player.startingStack + player.committed - (awards.get(player.userId) ?? 0);
    if (!validInteger(amount)) unavailable("invalid-final-stack-equation");
    if (amount > 0) returns.set(player.userId, amount);
  }
  if (returns.size !== expected.returns.size || [...returns].some(([userId, amount]) => expected.returns.get(userId) !== amount)) {
    unavailable("pot-award-final-stack-mismatch");
  }
  const committedTotal = players.reduce((sum, player) => sum + player.committed, 0);
  const potTotal = pots.reduce((sum, pot) => sum + pot.amount, 0);
  const returnTotal = [...returns.values()].reduce((sum, amount) => sum + amount, 0);
  if (committedTotal !== potTotal + returnTotal) unavailable("pot-conservation");

  const events: HistoryEvent[] = [];
  const add = eventFactory(events);
  add("HAND_STARTED", "PREFLOP");
  const contributions = new Map(players.map((player) => [player.userId, 0]));
  const blindPlayers = bombPotBlind === null
    ? [players.find((candidate) => candidate.seatIndex === hand.smallBlindSeat)!, players.find((candidate) => candidate.seatIndex === hand.bigBlindSeat)!]
    : [...players].sort((left, right) => left.seatIndex - right.seatIndex);
  for (const player of blindPlayers) {
    const paid = postedBlindFor(player);
    contributions.set(player.userId, paid);
    add("BLIND_POSTED", "PREFLOP", { actorSeat: player.seatIndex, actorUserId: player.userId, amount: paid });
  }

  let currentStreet: HistoryEvent["street"] = "PREFLOP";
  if (bombPotBlind !== null) {
    if (hand.board.length < 3) unavailable("bomb-pot-missing-flop");
    add("FLOP_DEALT", "FLOP", { cards: hand.board.slice(0, 3) });
    currentStreet = "FLOP";
  }
  for (const action of actions) {
    currentStreet = orderedBoardEvents(hand.board, currentStreet, action.street, add);
    if (action.amount !== null) contributions.set(action.userId, (contributions.get(action.userId) ?? 0) + action.amount);
    add(actionEventType(action), action.street, {
      actorSeat: action.seatIndex,
      actorUserId: action.userId,
      amount: action.amount,
      automatic: action.automatic,
      raiseTo: action.raiseTo,
      stateVersion: action.stateVersion,
    });
  }
  const finalBoardStreet = hand.board.length === 5 ? "RIVER" : hand.board.length === 4 ? "TURN" : hand.board.length === 3 ? "FLOP" : "PREFLOP";
  currentStreet = orderedBoardEvents(hand.board, currentStreet, finalBoardStreet, add);

  for (const player of players) {
    if (contributions.get(player.userId) !== player.committed) unavailable("action-contribution-mismatch");
  }

  if (hand.finishReason === "SHOWDOWN") {
    currentStreet = "SHOWDOWN";
    add("SHOWDOWN", currentStreet);
    for (const player of players) {
      if (player.holeCardsVisibility === "PUBLIC_SHOWDOWN") {
        add("CARDS_REVEALED", currentStreet, { actorSeat: player.seatIndex, actorUserId: player.userId, cards: [...player.holeCards], visibility: "PUBLIC" });
      }
    }
  }
  for (const pot of pots) {
    add("POT_AWARDED", currentStreet, { amount: pot.amount, potIndex: pot.potIndex, winners: [...pot.winners] });
    for (const winner of pot.oddChipRecipients) {
      add("ODD_CHIP_AWARDED", currentStreet, { actorUserId: winner, amount: 1, potIndex: pot.potIndex, winners: [winner] });
    }
  }
  for (const player of players) {
    const amount = returns.get(player.userId);
    if (amount) add("UNCALLED_BET_RETURNED", currentStreet, { actorSeat: player.seatIndex, actorUserId: player.userId, amount });
  }
  add("HAND_FINISHED", currentStreet, { winners: [...new Set(pots.flatMap((pot) => pot.winners))] });
  for (const player of players) {
    if (player.holeCardsVisibility === "PUBLIC_VOLUNTARY") {
      add("CARDS_REVEALED", currentStreet, { actorSeat: player.seatIndex, actorUserId: player.userId, cards: [...player.holeCards], visibility: "PUBLIC" });
    }
    if (player.holeCardsVisibility === "PURCHASED") {
      add("CARDS_REVEALED", currentStreet, { actorSeat: player.seatIndex, actorUserId: player.userId, cards: [...player.holeCards], visibility: "PURCHASED_AFTER_HAND" });
    }
  }

  const ownPlayer = players.find((player) => player.holeCardsVisibility === "OWN");
  const initialState: ReplayInitialState = {
    bigBlindSeat: hand.bigBlindSeat,
    blinds: { bigBlind: hand.bigBlindAmount, smallBlind: hand.smallBlindAmount },
    board: [],
    buttonSeat: hand.buttonSeat,
    ownHoleCards: ownPlayer ? [ownPlayer.holeCards[0]!, ownPlayer.holeCards[1]!] : null,
    players: [...players].sort((left, right) => left.seatIndex - right.seatIndex).map(projectedInitialPlayer),
    pot: 0,
    pots: [],
    publicHoleCardsAtStart: [],
    smallBlindSeat: hand.smallBlindSeat,
    startingStacks: [...players].sort((left, right) => left.seatIndex - right.seatIndex).map((player) => ({ stack: player.startingStack, userId: player.userId })),
    street: "PREFLOP",
    winners: [],
  };
  let finalState: ReplayState;
  try {
    finalState = reduceReplayEvents(initialState, events);
  } catch (error: unknown) {
    unavailable(error instanceof Error ? `reducer:${error.message}` : "reducer-error");
  }
  const stackMismatches = finalState.players.flatMap((player) => {
    const expectedStack = players.find((candidate) => candidate.userId === player.userId)?.endingStack;
    return player.stack === expectedStack ? [] : [{ actual: player.stack, expected: expectedStack, userId: player.userId }];
  });
  const statusMismatches = finalState.players.flatMap((player) => {
    const expectedPlayer = players.find((candidate) => candidate.userId === player.userId);
    return expectedPlayer && player.folded === expectedPlayer.folded && player.allIn === expectedPlayer.allIn
      ? []
      : [{ actualAllIn: player.allIn, actualFolded: player.folded, expectedAllIn: expectedPlayer?.allIn, expectedFolded: expectedPlayer?.folded, userId: player.userId }];
  });
  const livePlayers = players.filter((player) => !player.folded).length;
  const finishShapeInvalid = hand.finishReason === "FOLD_TO_WIN" ? livePlayers !== 1 : livePlayers < 2;
  if (finalState.pot !== 0 || finalState.pots.some((amount) => amount !== 0) || stackMismatches.length > 0 || statusMismatches.length > 0 || finishShapeInvalid) {
    unavailable(`final-state-mismatch:${JSON.stringify({ finishShapeInvalid, pot: finalState.pot, pots: finalState.pots, stacks: stackMismatches, statuses: statusMismatches })}`);
  }
  return HandReplaySchema.parse({ events, finalState, handId: hand.id, initialState, schemaVersion: 1 });
}
