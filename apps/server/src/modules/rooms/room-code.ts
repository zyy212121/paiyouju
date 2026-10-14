import { randomInt } from "node:crypto";

export type RoomCodeRandomInteger = () => number;

export function createRoomCode(
  randomInteger: RoomCodeRandomInteger = () => randomInt(0, 1_000_000),
): string {
  const value = randomInteger();
  if (!Number.isInteger(value) || value < 0 || value > 999_999) {
    throw new RangeError("room code source returned an out-of-range value");
  }
  return value.toString().padStart(6, "0");
}
