export const BOMB_POT_INTERVAL_MINUTES_OPTIONS = [1, 5, 10, 15, 20, 25, 30] as const;
export const BOMB_POT_INTERVAL_MINUTES_MIN = 1 as const;
export const BOMB_POT_INTERVAL_MINUTES_MAX = 30 as const;
export const BOMB_POT_INTERVAL_MINUTES_STEP = 5 as const;
export const DEFAULT_BOMB_POT_INTERVAL_MINUTES = 10 as const;
export const BOMB_POT_BLIND_MULTIPLIER_MIN = 1 as const;
export const BOMB_POT_BLIND_MULTIPLIER_MAX = 10 as const;
export const DEFAULT_BOMB_POT_BLIND_MULTIPLIER = 3 as const;

export function isBombPotIntervalMinutes(value: number): boolean {
  return BOMB_POT_INTERVAL_MINUTES_OPTIONS.some((option) => option === value);
}
