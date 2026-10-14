export interface SeatPosition { readonly x: number; readonly y: number }

const layouts: Readonly<Record<number, readonly SeatPosition[]>> = {
  2: [{ x: 50, y: 88 }, { x: 50, y: 15 }],
  3: [{ x: 50, y: 88 }, { x: 12, y: 35 }, { x: 88, y: 35 }],
  4: [{ x: 50, y: 88 }, { x: 12, y: 50 }, { x: 50, y: 15 }, { x: 88, y: 50 }],
  5: [{ x: 50, y: 88 }, { x: 12, y: 62 }, { x: 23, y: 16 }, { x: 77, y: 16 }, { x: 88, y: 62 }],
  6: [{ x: 50, y: 88 }, { x: 12, y: 72 }, { x: 12, y: 28 }, { x: 50, y: 15 }, { x: 88, y: 28 }, { x: 88, y: 72 }],
  7: [{ x: 50, y: 88 }, { x: 15, y: 78 }, { x: 12, y: 40 }, { x: 31, y: 15 }, { x: 69, y: 15 }, { x: 88, y: 40 }, { x: 85, y: 78 }],
  8: [{ x: 50, y: 88 }, { x: 18, y: 84 }, { x: 12, y: 56 }, { x: 13, y: 22 }, { x: 50, y: 15 }, { x: 87, y: 22 }, { x: 88, y: 56 }, { x: 82, y: 84 }],
  9: [{ x: 50, y: 88 }, { x: 21, y: 86 }, { x: 12, y: 63 }, { x: 12, y: 32 }, { x: 27, y: 15 }, { x: 73, y: 15 }, { x: 88, y: 32 }, { x: 88, y: 63 }, { x: 79, y: 86 }],
};

export function seatPosition(actualSeatIndex: number, maxSeats: number, heroSeatIndex: number): SeatPosition {
  const layout = layouts[maxSeats];
  if (!layout) throw new Error("unsupported seat count");
  const visualIndex = (actualSeatIndex - heroSeatIndex + maxSeats) % maxSeats;
  return layout[visualIndex]!;
}
