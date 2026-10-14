const MAX_TABLE_POINTS = 2_000_000_000;

export const SQUID_STAKE_TIER_COUNT = 5 as const;

export function squidStakeOptions(initialBuyIn: number): readonly [number, number, number, number, number] {
  if (!Number.isSafeInteger(initialBuyIn) || initialBuyIn <= 0 || initialBuyIn > MAX_TABLE_POINTS) {
    throw new RangeError("initial buy-in must be a positive safe table-points integer");
  }
  const base = Math.ceil(initialBuyIn / 100);
  return [base, base * 2, base * 3, base * 4, base * 5];
}
