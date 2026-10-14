import {
  BOMB_POT_BLIND_MULTIPLIER_MAX,
  BOMB_POT_BLIND_MULTIPLIER_MIN,
  isBombPotIntervalMinutes,
  MAX_POINTS,
} from "@paiyouju/shared";

interface ResolveBombPotHandStartInput {
  readonly intervalMinutes: number;
  readonly nextAt: Date | null;
  readonly now: Date;
  readonly tableStartedAt: Date | null;
}

export interface BombPotHandStartResolution {
  readonly bombPot: boolean;
  readonly nextAt: Date;
}

function assertInterval(intervalMinutes: number): void {
  if (!Number.isSafeInteger(intervalMinutes) || !isBombPotIntervalMinutes(intervalMinutes)) {
    throw new RangeError("invalid bomb-pot interval");
  }
}

export function bombPotBlindAmount(bigBlind: number, multiplier: number): number {
  if (!Number.isSafeInteger(bigBlind) || bigBlind <= 0
    || !Number.isSafeInteger(multiplier)
    || multiplier < BOMB_POT_BLIND_MULTIPLIER_MIN
    || multiplier > BOMB_POT_BLIND_MULTIPLIER_MAX) {
    throw new RangeError("invalid bomb-pot blind configuration");
  }
  const amount = bigBlind * multiplier;
  if (!Number.isSafeInteger(amount) || amount > MAX_POINTS) {
    throw new RangeError("bomb-pot blind exceeds the safe points limit");
  }
  return amount;
}

export function resolveBombPotHandStart(input: ResolveBombPotHandStartInput): BombPotHandStartResolution {
  assertInterval(input.intervalMinutes);
  const intervalMs = input.intervalMinutes * 60_000;
  const scheduledAt = input.nextAt
    ?? new Date((input.tableStartedAt ?? input.now).getTime() + intervalMs);
  if (input.tableStartedAt === null || input.now.getTime() < scheduledAt.getTime()) {
    return { bombPot: false, nextAt: scheduledAt };
  }
  return { bombPot: true, nextAt: new Date(input.now.getTime() + intervalMs) };
}
