import { PokerRuleError } from "./errors.js";
import type { PlayerHandState, SeatState } from "./types.js";

function nextSeatIndex(from: number, maxSeats: number): number {
  return (from + 1 + maxSeats) % maxSeats;
}

export function clockwiseSeatOrder(fromExclusive: number, maxSeats: number): readonly number[] {
  return Array.from({ length: maxSeats }, (_, offset) =>
    (fromExclusive + offset + 1 + maxSeats) % maxSeats);
}

export function getNextButtonSeat(
  seats: readonly SeatState[], previousButtonSeat: number | null, maxSeats: number,
): number {
  const eligible = new Set(seats.filter((seat) => seat.isParticipating && seat.stack > 0).map((seat) => seat.seatIndex));
  if (eligible.size < 2) {
    throw new PokerRuleError("INSUFFICIENT_ACTIVE_PLAYERS", "At least two eligible players are required", { eligiblePlayers: eligible.size });
  }
  if (previousButtonSeat === null) return Math.min(...eligible);
  let candidate = previousButtonSeat;
  for (let checked = 0; checked < maxSeats; checked += 1) {
    candidate = nextSeatIndex(candidate, maxSeats);
    if (eligible.has(candidate)) return candidate;
  }
  throw new PokerRuleError("STATE_INVARIANT_VIOLATION", "No eligible button seat found");
}

export function nextMatchingSeat(
  players: readonly Pick<PlayerHandState, "seatIndex" | "hasFolded" | "isAllIn">[],
  fromExclusive: number,
  maxSeats: number,
  predicate: (player: Pick<PlayerHandState, "seatIndex" | "hasFolded" | "isAllIn">) => boolean,
): number | null {
  for (const seat of clockwiseSeatOrder(fromExclusive, maxSeats)) {
    const player = players.find((candidate) => candidate.seatIndex === seat);
    if (player !== undefined && predicate(player)) return seat;
  }
  return null;
}
