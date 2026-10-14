import { compareHandStrength } from "../compare.js";
import { evaluateSevenCards } from "../evaluate-seven.js";
import { PokerRuleError } from "./errors.js";
import { buildPots } from "./pots.js";
import { clockwiseSeatOrder } from "./seats.js";
import type { Card } from "../card.js";
import type { HandState, Pot, PotAward, RunoutSettlement, SettlementResult } from "./types.js";

function add(record: Record<string, number>, playerId: string, amount: number): void {
  record[playerId] = (record[playerId] ?? 0) + amount;
}

function awardPots(
  state: HandState,
  board: readonly Card[],
  pots: readonly Pot[],
  amounts: readonly number[],
  uncontestedWinnerId?: string,
): { readonly pots: readonly PotAward[]; readonly awardsByPlayer: Readonly<Record<string, number>> } {
  const awardsByPlayer: Record<string, number> = {};
  const awards: PotAward[] = [];
  const seatOrder = clockwiseSeatOrder(state.buttonSeat, state.config.maxSeats);

  for (const [potIndex, pot] of pots.entries()) {
    const potAmount = amounts[potIndex]!;
    let winners: readonly string[];
    if (uncontestedWinnerId !== undefined) {
      winners = [uncontestedWinnerId];
    } else {
      const contenders = pot.eligiblePlayers.map((playerId) => {
        const player = state.players.find((candidate) => candidate.playerId === playerId)!;
        return { playerId, evaluation: evaluateSevenCards([...player.holeCards, ...board], state.config.variant) };
      });
      if (contenders.length === 0) {
        throw new PokerRuleError("STATE_INVARIANT_VIOLATION", "Pot has no eligible player", { potIndex });
      }
      const best = contenders.reduce((current, contender) =>
        compareHandStrength(contender.evaluation, current.evaluation, state.config.variant) > 0 ? contender : current);
      winners = contenders.filter((contender) => compareHandStrength(contender.evaluation, best.evaluation, state.config.variant) === 0).map((contender) => contender.playerId);
    }
    const baseShare = Math.floor(potAmount / winners.length);
    const remainder = potAmount % winners.length;
    const orderedWinners = seatOrder.map((seat) => state.players.find((player) => player.seatIndex === seat)).filter((player) => player !== undefined && winners.includes(player.playerId)).map((player) => player!.playerId);
    const oddChipRecipients = orderedWinners.slice(0, remainder);
    const potAwards: Record<string, number> = {};
    for (const winner of winners) {
      const amount = baseShare + (oddChipRecipients.includes(winner) ? 1 : 0);
      add(potAwards, winner, amount);
      if (amount > 0) add(awardsByPlayer, winner, amount);
    }
    awards.push({ ...pot, amount: potAmount, winners, amountPerWinner: baseShare, oddChipRecipients, awards: potAwards });
  }

  return { pots: awards, awardsByPlayer };
}

export function settleHand(state: HandState, uncontestedWinnerId?: string): SettlementResult {
  const built = buildPots(state.players);
  const awarded = awardPots(state, state.board, built.pots, built.pots.map((pot) => pot.amount), uncontestedWinnerId);
  const awardsByPlayer = awarded.awardsByPlayer;

  const finalStacks: Record<string, number> = {};
  for (const player of state.players) {
    finalStacks[player.playerId] = player.stack + (awardsByPlayer[player.playerId] ?? 0);
  }
  const revealedPlayers = uncontestedWinnerId === undefined ? state.players.filter((player) => !player.hasFolded).map((player) => player.playerId) : [];
  return {
    pots: awarded.pots,
    awardsByPlayer,
    uncalledReturnsByPlayer: built.uncalledReturnsByPlayer,
    finalStacks,
    revealedPlayers,
    winners: Object.keys(awardsByPlayer).filter((playerId) => (awardsByPlayer[playerId] ?? 0) > 0),
  };
}

export function settleRunoutBoards(
  state: HandState,
  boards: readonly [readonly Card[], readonly Card[]],
): SettlementResult {
  const built = buildPots(state.players);
  const firstAmounts = built.pots.map((pot) => Math.ceil(pot.amount / 2));
  const secondAmounts = built.pots.map((pot, index) => pot.amount - firstAmounts[index]!);
  const first = awardPots(state, boards[0], built.pots, firstAmounts);
  const second = awardPots(state, boards[1], built.pots, secondAmounts);
  const aggregateAwards: Record<string, number> = {};
  for (const awards of [first.awardsByPlayer, second.awardsByPlayer]) {
    for (const [playerId, amount] of Object.entries(awards)) add(aggregateAwards, playerId, amount);
  }

  const combinedPots = built.pots.map((pot, potIndex): PotAward => {
    const combinedAwards: Record<string, number> = {};
    for (const runout of [first, second]) {
      for (const [playerId, amount] of Object.entries(runout.pots[potIndex]!.awards)) {
        if (amount > 0) add(combinedAwards, playerId, amount);
      }
    }
    return {
      ...pot,
      awards: combinedAwards,
      winners: Object.keys(combinedAwards),
      // These two fields describe ordinary single-board equal splits. Per-board
      // authoritative metadata is stored in `runouts` below.
      amountPerWinner: 0,
      oddChipRecipients: [],
    };
  });
  const finalStacks: Record<string, number> = {};
  for (const player of state.players) finalStacks[player.playerId] = player.stack + (aggregateAwards[player.playerId] ?? 0);
  const toRunout = (runoutIndex: 1 | 2, board: readonly Card[], awarded: typeof first): RunoutSettlement => ({
    runoutIndex,
    board,
    pots: awarded.pots,
    awardsByPlayer: awarded.awardsByPlayer,
    winners: Object.keys(awarded.awardsByPlayer).filter((playerId) => (awarded.awardsByPlayer[playerId] ?? 0) > 0),
  });
  return {
    pots: combinedPots,
    awardsByPlayer: aggregateAwards,
    uncalledReturnsByPlayer: built.uncalledReturnsByPlayer,
    finalStacks,
    revealedPlayers: state.players.filter((player) => !player.hasFolded).map((player) => player.playerId),
    winners: Object.keys(aggregateAwards).filter((playerId) => (aggregateAwards[playerId] ?? 0) > 0),
    runouts: [toRunout(1, boards[0], first), toRunout(2, boards[1], second)],
  };
}
