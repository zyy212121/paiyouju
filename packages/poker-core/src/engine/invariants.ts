import { serializeCard } from "../card.js";
import { PokerRuleError } from "./errors.js";
import { buildPots } from "./pots.js";
import type { HandState, Pot, PotAward } from "./types.js";

function fail(state: HandState, message: string, extra: Readonly<Record<string, unknown>> = {}): never {
  throw new PokerRuleError("STATE_INVARIANT_VIOLATION", message, {
    handId: state.handId,
    stateVersion: state.stateVersion,
    street: state.street,
    currentActorSeat: state.currentActorSeat,
    actionHistory: state.actionHistory,
    ...extra,
  });
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((member) => right.includes(member));
}

function sameAmountRecord(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([playerId, amount]) => right[playerId] === amount);
}

function collectValidatedAward(
  state: HandState,
  pot: PotAward,
  expectedPot: Pot,
  potIndex: number,
  context: string,
  allowZero: boolean,
): Readonly<Record<string, number>> {
  if ((!allowZero && pot.amount <= 0)
    || (allowZero && pot.amount < 0)
    || !Number.isSafeInteger(pot.amount)
    || !sameMembers(pot.contributors, expectedPot.contributors)
    || !sameMembers(pot.eligiblePlayers, expectedPot.eligiblePlayers)) {
    fail(state, `${context} pot does not match canonical contributions`, { potIndex });
  }
  if (pot.winners.length === 0
    || !pot.winners.every((winner) => pot.eligiblePlayers.includes(winner))
    || !sameMembers(Object.keys(pot.awards), pot.winners)
    || new Set(pot.oddChipRecipients).size !== pot.oddChipRecipients.length
    || !pot.oddChipRecipients.every((winner) => pot.winners.includes(winner))) {
    fail(state, `${context} pot winners and awards must be eligible and unique`, { potIndex });
  }
  const amountPerWinner = Math.floor(pot.amount / pot.winners.length);
  const remainder = pot.amount % pot.winners.length;
  if (pot.amountPerWinner !== amountPerWinner || pot.oddChipRecipients.length !== remainder) {
    fail(state, `${context} pot split metadata does not match its amount`, { potIndex });
  }
  const collected: Record<string, number> = {};
  let total = 0;
  for (const winner of pot.winners) {
    const amount = pot.awards[winner];
    const expectedAmount = amountPerWinner + (pot.oddChipRecipients.includes(winner) ? 1 : 0);
    if (!Number.isSafeInteger(amount) || amount !== expectedAmount) {
      fail(state, `${context} pot award amount does not match the declared split`, { playerId: winner, potIndex });
    }
    total += amount;
    if (amount > 0) collected[winner] = (collected[winner] ?? 0) + amount;
  }
  if (total !== pot.amount) fail(state, `${context} pot awards must equal the pot amount`, { potIndex });
  return collected;
}

export function assertHandStateInvariants(state: HandState, previousState?: HandState): void {
  if (!Number.isSafeInteger(state.stateVersion) || state.stateVersion < 1) fail(state, "State version must be a positive safe integer");
  if (state.bombPotBlind !== undefined && (!Number.isSafeInteger(state.bombPotBlind) || state.bombPotBlind <= 0)) fail(state, "Bomb-pot blind must be a positive safe integer");
  if (previousState !== undefined && state.stateVersion <= previousState.stateVersion) fail(state, "State version must strictly increase", { previousStateVersion: previousState.stateVersion });

  for (const player of state.players) {
    if (![player.startingStack, player.stack, player.committedThisStreet, player.committedThisHand].every(Number.isSafeInteger)) fail(state, "Chip values must be safe integers", { playerId: player.playerId });
    if (player.stack < 0 || player.committedThisStreet < 0 || player.committedThisHand < 0) fail(state, "Chip values cannot be negative", { playerId: player.playerId });
    if (player.committedThisStreet > player.committedThisHand) fail(state, "Street commitment cannot exceed hand commitment", { playerId: player.playerId });
    const expected = state.status === "finished" ? player.startingStack : player.startingStack - player.committedThisHand;
    if (state.status !== "finished" && player.stack !== expected) fail(state, "Unsettled stack and commitment must equal starting stack", { playerId: player.playerId });
  }

  let runoutOnlyCards = [] as typeof state.board;
  if (state.runoutBoards !== undefined) {
    const shared = state.runoutSharedCardCount;
    if (!Number.isSafeInteger(shared) || shared === undefined || shared < 0 || shared > 5
      || state.runoutBoards.some((board) => board.length !== 5)
      || state.board.length !== 5
      || state.board.some((card, index) => serializeCard(card) !== serializeCard(state.runoutBoards![0][index]!))
      || state.runoutBoards[0].slice(0, shared).some((card, index) => serializeCard(card) !== serializeCard(state.runoutBoards![1][index]!))) {
      fail(state, "Two-board runout metadata is inconsistent");
    }
    runoutOnlyCards = state.runoutBoards[1].slice(shared);
  }
  const allCards = [...state.players.flatMap((player) => player.holeCards), ...state.board, ...runoutOnlyCards, ...state.deck];
  const codes = allCards.map(serializeCard);
  if (new Set(codes).size !== codes.length) fail(state, "Cards cannot appear more than once");
  const expectedCardCount = state.config.variant === "SHORT_DECK" ? 36 : 52;
  if (allCards.length !== expectedCardCount) fail(state, `Hole cards, board, and deck must total ${String(expectedCardCount)}`, { cardCount: allCards.length });
  if (state.config.variant === "SHORT_DECK" && allCards.some((card) => card.rank < 6)) fail(state, "Short-deck hands cannot contain cards below six");

  const expectedBoardCounts: Readonly<Record<HandState["street"], readonly number[]>> = {
    preflop: [0], flop: [3], turn: [4], river: [5], showdown: [5],
  };
  if (!expectedBoardCounts[state.street].includes(state.board.length)) fail(state, "Board count does not match street", { boardCount: state.board.length });
  const maximumCommitment = Math.max(0, ...state.players.map((player) => player.committedThisStreet));
  if (state.currentBet !== maximumCommitment) fail(state, "Current bet must equal the highest street commitment", { maximumCommitment });
  if (state.currentActorSeat !== null) {
    const actor = state.players.find((player) => player.seatIndex === state.currentActorSeat);
    if (actor === undefined || actor.hasFolded || actor.isAllIn || state.status !== "active") fail(state, "Current actor must be an active actionable player");
  }
  for (const pot of state.pots) {
    if (!Number.isSafeInteger(pot.amount) || pot.amount < 0) fail(state, "Pot amount must be a non-negative safe integer");
    for (const eligible of pot.eligiblePlayers) {
      const player = state.players.find((candidate) => candidate.playerId === eligible);
      if (player === undefined || player.hasFolded) fail(state, "Only non-folded players can be pot eligible", { playerId: eligible });
    }
  }
  if (state.status === "finished") {
    if (state.settlement === null) fail(state, "Finished hands require settlement");
    const settlement = state.settlement;
    const expected = buildPots(state.players);
    if (state.pots.length !== settlement.pots.length || settlement.pots.length !== expected.pots.length) {
      fail(state, "Finished pot layers must match canonical settlement layers");
    }
    const awardsByPlayer: Record<string, number> = {};
    if (settlement.runouts === undefined) {
      if (state.runoutBoards !== undefined) fail(state, "Single-board settlement cannot contain two boards");
      for (const [potIndex, pot] of settlement.pots.entries()) {
        const statePot = state.pots[potIndex]!;
        const expectedPot = expected.pots[potIndex]!;
        if (pot.amount !== statePot.amount || pot.amount !== expectedPot.amount) fail(state, "Finished pot amount is not canonical", { potIndex });
        if (potIndex > 0 && sameMembers(settlement.pots[potIndex - 1]!.eligiblePlayers, pot.eligiblePlayers)) {
          fail(state, "Adjacent pots cannot have identical eligible players", { potIndex });
        }
        for (const [playerId, amount] of Object.entries(collectValidatedAward(state, pot, expectedPot, potIndex, "Finished", false))) {
          awardsByPlayer[playerId] = (awardsByPlayer[playerId] ?? 0) + amount;
        }
      }
    } else {
      if (state.runoutBoards === undefined || settlement.runouts.length !== 2) fail(state, "Two-board settlement requires exactly two boards");
      const runoutBoards = state.runoutBoards;
      for (const [runoutOffset, runout] of settlement.runouts.entries()) {
        const runoutIndex = (runoutOffset + 1) as 1 | 2;
        if (runout.runoutIndex !== runoutIndex
          || runout.pots.length !== expected.pots.length
          || runout.board.some((card, index) => serializeCard(card) !== serializeCard(runoutBoards[runoutOffset]![index]!))) {
          fail(state, "Runout settlement metadata does not match its board", { runoutIndex });
        }
        const runoutAwards: Record<string, number> = {};
        for (const [potIndex, pot] of runout.pots.entries()) {
          const expectedAmount = runoutIndex === 1
            ? Math.ceil(expected.pots[potIndex]!.amount / 2)
            : expected.pots[potIndex]!.amount - Math.ceil(expected.pots[potIndex]!.amount / 2);
          if (pot.amount !== expectedAmount) fail(state, "Runout pot does not follow deterministic integer split", { potIndex, runoutIndex });
          for (const [playerId, amount] of Object.entries(collectValidatedAward(state, pot, expected.pots[potIndex]!, potIndex, `Runout ${runoutIndex}`, true))) {
            runoutAwards[playerId] = (runoutAwards[playerId] ?? 0) + amount;
            awardsByPlayer[playerId] = (awardsByPlayer[playerId] ?? 0) + amount;
          }
        }
        if (!sameAmountRecord(runout.awardsByPlayer, runoutAwards)
          || !sameMembers(runout.winners, Object.keys(runoutAwards))) {
          fail(state, "Runout aggregate awards do not match its pots", { runoutIndex });
        }
      }
      for (const [potIndex, pot] of settlement.pots.entries()) {
        const expectedPot = expected.pots[potIndex]!;
        const statePot = state.pots[potIndex]!;
        if (pot.amount !== expectedPot.amount || pot.amount !== statePot.amount
          || !sameMembers(pot.contributors, expectedPot.contributors)
          || !sameMembers(pot.eligiblePlayers, expectedPot.eligiblePlayers)) {
          fail(state, "Combined two-board pot is not canonical", { potIndex });
        }
        const combinedAwards: Record<string, number> = {};
        for (const runout of settlement.runouts) {
          for (const [playerId, amount] of Object.entries(runout.pots[potIndex]!.awards)) {
            if (amount > 0) combinedAwards[playerId] = (combinedAwards[playerId] ?? 0) + amount;
          }
        }
        if (!sameAmountRecord(pot.awards, combinedAwards)
          || !sameMembers(pot.winners, Object.keys(combinedAwards))
          || Object.values(pot.awards).reduce((sum, amount) => sum + amount, 0) !== pot.amount) {
          fail(state, "Combined two-board pot awards must equal both runouts", { potIndex });
        }
      }
    }
    if (!sameAmountRecord(settlement.awardsByPlayer, awardsByPlayer)
      || !sameAmountRecord(settlement.uncalledReturnsByPlayer, expected.uncalledReturnsByPlayer)) {
      fail(state, "Settlement aggregates must match canonical pot awards and returns");
    }
    const expectedFinalStacks: Record<string, number> = {};
    for (const player of state.players) {
      expectedFinalStacks[player.playerId] = player.startingStack - player.committedThisHand
        + (awardsByPlayer[player.playerId] ?? 0);
      if (player.stack !== expectedFinalStacks[player.playerId]) {
        fail(state, "Finished player stack must match settlement distribution", { playerId: player.playerId });
      }
    }
    if (!sameAmountRecord(settlement.finalStacks, expectedFinalStacks)
      || !sameMembers(settlement.winners, Object.keys(awardsByPlayer))) {
      fail(state, "Settlement final stacks and winners must match distributed awards");
    }
    const committed = state.players.reduce((sum, player) => sum + player.committedThisHand, 0);
    const settled = settlement.pots.reduce((sum, pot) => sum + pot.amount, 0);
    if (committed !== settled) fail(state, "Pots must contain every committed chip", { committed, settled });
    const starting = state.players.reduce((sum, player) => sum + player.startingStack, 0);
    const final = state.players.reduce((sum, player) => sum + player.stack, 0);
    if (starting !== final) fail(state, "Finished hand must conserve chips", { starting, final });
  }
}
