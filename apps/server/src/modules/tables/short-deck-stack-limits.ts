export interface ShortDeckStackLimitResolution {
  readonly adjustment: number;
  readonly finalStack: number;
  readonly type: "BUY_IN" | "CASH_OUT" | null;
}

export function resolveShortDeckStackLimit(
  stack: number,
  minimum: number,
  maximum: number,
): ShortDeckStackLimitResolution {
  if (![stack, minimum, maximum].every(Number.isSafeInteger)
    || stack < 0
    || minimum <= 0
    || maximum < minimum) {
    throw new RangeError("Invalid short-deck stack limits");
  }
  if (stack < minimum) {
    return { adjustment: minimum - stack, finalStack: minimum, type: "BUY_IN" };
  }
  if (stack > maximum) {
    return { adjustment: maximum - stack, finalStack: maximum, type: "CASH_OUT" };
  }
  return { adjustment: 0, finalStack: stack, type: null };
}
