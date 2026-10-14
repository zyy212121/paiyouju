export type HistoryRunoutIndex = 1 | 2;

export interface HistoryRunoutPotLike {
  readonly amount: number;
  readonly oddChipRecipients: readonly string[];
  readonly winners: readonly string[];
}

export function splitForRunout(value: number, runoutIndex: HistoryRunoutIndex): number {
  const first = Math.ceil(value / 2);
  return runoutIndex === 1 ? first : value - first;
}

export function runoutIndices(runoutCount: number): readonly (HistoryRunoutIndex | null)[] {
  return runoutCount === 2 ? [1, 2] : [null];
}

export function displayHandNumber(handNumber: number, runoutIndex: HistoryRunoutIndex | null): string {
  return runoutIndex === null ? String(handNumber) : `${handNumber}-${runoutIndex}`;
}

export function awardForUser(pots: readonly HistoryRunoutPotLike[], userId: string): number {
  return pots.reduce((total, pot) => {
    if (!pot.winners.includes(userId) || pot.winners.length === 0) return total;
    return total + Math.floor(pot.amount / pot.winners.length) + (pot.oddChipRecipients.includes(userId) ? 1 : 0);
  }, 0);
}

export function projectRunoutPlayerAmounts(input: {
  readonly committed: number;
  readonly pots: readonly HistoryRunoutPotLike[];
  readonly runoutIndex: HistoryRunoutIndex;
  readonly startingStack: number;
  readonly userId: string;
}) {
  const committed = splitForRunout(input.committed, input.runoutIndex);
  const award = awardForUser(input.pots, input.userId);
  const netResult = award - committed;
  return {
    committed,
    endingStack: input.startingStack + netResult,
    netResult,
    wonAnyPot: award > 0,
  } as const;
}
