import { PokerRuleError } from "./errors.js";
import type { PlayerHandState, Pot } from "./types.js";

export interface BuiltPots {
  readonly pots: readonly Pot[];
  readonly uncalledReturnsByPlayer: Readonly<Record<string, number>>;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((member) => right.includes(member));
}

function appendCanonicalPot(pots: Pot[], pot: Pot): void {
  const previous = pots.at(-1);
  if (previous !== undefined && sameMembers(previous.eligiblePlayers, pot.eligiblePlayers)) {
    pots[pots.length - 1] = {
      amount: previous.amount + pot.amount,
      contributors: [...new Set([...previous.contributors, ...pot.contributors])],
      eligiblePlayers: previous.eligiblePlayers,
    };
    return;
  }
  pots.push(pot);
}

export function buildPots(players: readonly PlayerHandState[]): BuiltPots {
  const levels = [...new Set(players.map((player) => player.committedThisHand).filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.committedThisHand >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) {
      const eligiblePlayers = contributors.filter((player) => !player.hasFolded).map((player) => player.playerId);
      const contributorIds = contributors.map((player) => player.playerId);
      if (eligiblePlayers.length === 0) {
        const previousPot = pots.at(-1);
        if (previousPot === undefined) {
          throw new PokerRuleError("STATE_INVARIANT_VIOLATION", "Dead-money layer has no preceding eligible pot", { level, amount });
        }
        pots[pots.length - 1] = {
          ...previousPot,
          amount: previousPot.amount + amount,
          contributors: [...new Set([...previousPot.contributors, ...contributorIds])],
        };
      } else {
        appendCanonicalPot(pots, { amount, contributors: contributorIds, eligiblePlayers });
      }
    }
    previous = level;
  }
  return { pots, uncalledReturnsByPlayer: {} };
}

/**
 * Projects every chip currently committed during an active hand. Final
 * settlement follows the same all-committed-chips-enter-pots rule.
 * A side pot boundary is shown only when an all-in commitment caps eligibility.
 */
export function buildDisplayPotAmounts(players: readonly PlayerHandState[]): readonly number[] {
  const contributors = players.filter((player) => player.committedThisHand > 0);
  const totalCommitted = contributors.reduce((sum, player) => sum + player.committedThisHand, 0);
  if (totalCommitted === 0) return [];

  const allInCaps = [...new Set(
    contributors
      .filter((player) => player.isAllIn)
      .map((player) => player.committedThisHand),
  )].sort((left, right) => left - right);
  if (allInCaps.length === 0) return [totalCommitted];

  const amounts: number[] = [];
  let previousCap = 0;
  const appendLayer = (amount: number, layerContributorCount: number): void => {
    if (amount <= 0) return;
    if (amounts.length > 0 && layerContributorCount < 2) {
      amounts[amounts.length - 1] = amounts[amounts.length - 1]! + amount;
    } else {
      amounts.push(amount);
    }
  };

  for (const cap of allInCaps) {
    const amount = contributors.reduce(
      (sum, player) => sum + Math.max(0, Math.min(player.committedThisHand, cap) - Math.min(player.committedThisHand, previousCap)),
      0,
    );
    const layerContributorCount = contributors.filter((player) => player.committedThisHand > previousCap).length;
    appendLayer(amount, layerContributorCount);
    previousCap = cap;
  }

  const remainder = contributors.reduce(
    (sum, player) => sum + Math.max(0, player.committedThisHand - previousCap),
    0,
  );
  const remainderContributorCount = contributors.filter((player) => player.committedThisHand > previousCap).length;
  appendLayer(remainder, remainderContributorCount);
  return amounts;
}
